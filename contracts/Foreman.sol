// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Foreman — a spend permission for an autonomous maintenance agent.
/// @notice An AI agent watches machine telemetry and commits plant funds to
/// spare-part purchase orders. Routine POs settle autonomously inside an
/// on-chain budget; anything above the auto-approve line waits for a human.
/// The cap bounds the agent, not the plant — a human approval bypasses it.
contract Foreman {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Proposed,
        Funded,
        Shipped,
        Released,
        Cancelled,
        /// Issued from the store to the machine. A fitted part is no longer stock.
        Fitted
    }

    struct PO {
        address supplier;
        uint40 since; // timestamp of the last state transition
        Status status;
        bool agentFunded; // funded on the autonomous lane, so it consumed budget
        uint32 machineId;
        /**
         * Projected hours of life left when this was ordered. The value an
         * order buys back is fixed the moment it is placed — recomputing it
         * from today's projection makes a past decision's worth wander.
         */
        uint32 rulHoursAtOrder;
        uint128 amount;
        /**
         * Hash of the supplier's despatch document — waybill, consignment
         * note, whatever the carrier issues. Escrow does not move on a bare
         * click: the supplier commits to a reference with their own key
         * first, and the plant confirms against it. Feeding this from a
         * carrier API or a goods-in scanner is an integration, not a
         * redesign.
         */
        bytes32 deliveryRef;
        string partNo;
    }

    /// @dev Supplier may collect this long after shipping if the plant never
    /// confirms receipt, so a silent buyer cannot hold funds hostage.
    uint40 public constant RECEIPT_TIMEOUT = 14 days;
    uint40 public constant BUDGET_WINDOW = 30 days;

    /**
     * How long a proposal may sit unanswered before anyone may clear it.
     *
     * An open order blocks its machine-and-part line, and a proposal nobody
     * approves or rejects would block it for good — one forgotten decision
     * and the agent can never order that part for that machine again. Nothing
     * is escrowed while a PO is merely Proposed, so letting it lapse costs the
     * plant nothing and frees the line.
     */
    uint40 public constant PROPOSAL_TTL = 7 days;

    IERC20 public immutable token;

    /**
     * The human authority. Not immutable: a plant that loses this key would
     * otherwise have its treasury frozen for good, since only this address can
     * withdraw, approve or confirm. Handover is two-step so a mistyped address
     * cannot lock the contract — the new holder has to prove it can sign.
     */
    address public plant;
    address public nominatedPlant;

    address public agent;
    uint128 public monthlyCap;
    uint128 public autoApproveMax;

    uint128 public spentInWindow;
    uint40 public windowStart;

    uint128 public available; // deposited, uncommitted
    uint128 public escrowed; // committed to open POs

    /**
     * Payees the plant has vetted. The agent picks among them; it cannot
     * invent one. This is the line that holds if the model hallucinates an
     * address or someone poisons its inputs — the model chooses, the plant
     * decides who is choosable.
     */
    mapping(address => bool) public approvedSupplier;

    /**
     * One open order per machine and part. An agent that runs twice — because
     * a request was retried, or two operators pressed at once, or it simply
     * misread its own order book — cannot open a second order for a bearing
     * already on its way. The application checks this too, but a guarantee
     * that lives only in application memory is not a guarantee.
     */
    mapping(bytes32 => bool) private _openLine;

    PO[] private _pos;

    event PolicySet(address agent, uint128 monthlyCap, uint128 autoApproveMax);
    event SupplierSet(address indexed supplier, bool approved);
    event Deposited(uint128 amount);
    event Withdrawn(uint128 amount);
    event Proposed(uint256 indexed id, uint32 indexed machineId, address indexed supplier, uint128 amount, string partNo);
    event Funded(uint256 indexed id, uint128 amount, bool autonomous);
    event Shipped(uint256 indexed id, bytes32 deliveryRef);
    event Fitted(uint256 indexed id, uint32 indexed machineId, string partNo);
    event PlantNominated(address indexed nominee);
    event PlantTransferred(address indexed from, address indexed to);
    event Released(uint256 indexed id, address indexed supplier, uint128 amount);
    event Cancelled(uint256 indexed id, uint128 refunded);

    error NotPlant();
    error NotAgent();
    error NotSupplier();
    error BadStatus();
    error BadAmount();
    error BadSupplier();
    error SupplierNotApproved();
    error NoDeliveryRef();
    error DeliveryRefMismatch();
    error AlreadyOnOrder();
    error NotNominated();
    error BadPartNo();
    error CapExceeded();
    error Underfunded();
    error TooEarly();

    modifier onlyPlant() {
        if (msg.sender != plant) revert NotPlant();
        _;
    }

    constructor(IERC20 _token, address _agent, uint128 _monthlyCap, uint128 _autoApproveMax) {
        token = _token;
        plant = msg.sender;
        agent = _agent;
        monthlyCap = _monthlyCap;
        autoApproveMax = _autoApproveMax;
        windowStart = uint40(block.timestamp);
        emit PolicySet(_agent, _monthlyCap, _autoApproveMax);
    }

    // --- treasury ---

    function deposit(uint128 amount) external onlyPlant {
        if (amount == 0) revert BadAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        available += amount;
        emit Deposited(amount);
    }

    function withdraw(uint128 amount) external onlyPlant {
        if (amount > available) revert Underfunded();
        available -= amount;
        token.safeTransfer(plant, amount);
        emit Withdrawn(amount);
    }

    // --- policy ---

    function setPolicy(address _agent, uint128 _monthlyCap, uint128 _autoApproveMax) external onlyPlant {
        agent = _agent;
        monthlyCap = _monthlyCap;
        autoApproveMax = _autoApproveMax;
        emit PolicySet(_agent, _monthlyCap, _autoApproveMax);
    }

    /// @notice Start handing the plant role to a new key, or pass the zero
    /// address to call off a handover that has not been accepted.
    function nominatePlant(address nominee) external onlyPlant {
        nominatedPlant = nominee;
        emit PlantNominated(nominee);
    }

    /// @notice The nominee proves it can sign, and takes over.
    function acceptPlant() external {
        if (nominatedPlant == address(0) || msg.sender != nominatedPlant) revert NotNominated();
        emit PlantTransferred(plant, msg.sender);
        plant = msg.sender;
        nominatedPlant = address(0);
    }

    /// @notice Vet a payee, or drop one. Only the plant may widen the set the
    /// agent is allowed to pay.
    function setSupplier(address supplier, bool approved) external onlyPlant {
        if (supplier == address(0)) revert BadSupplier();
        approvedSupplier[supplier] = approved;
        emit SupplierSet(supplier, approved);
    }

    /// @notice Budget left on the autonomous lane right now.
    function remainingBudget() public view returns (uint128) {
        if (block.timestamp >= windowStart + BUDGET_WINDOW) return monthlyCap;
        return spentInWindow >= monthlyCap ? 0 : monthlyCap - spentInWindow;
    }

    // --- purchase orders ---

    /// @notice The agent proposes a PO. Below `autoApproveMax` it funds itself.
    function proposePO(
        uint32 machineId,
        string calldata partNo,
        address supplier,
        uint128 amount,
        uint32 rulHoursAtOrder
    ) external returns (uint256 id) {
        if (msg.sender != agent) revert NotAgent();
        if (!approvedSupplier[supplier]) revert SupplierNotApproved();
        if (amount == 0) revert BadAmount();

        /* The part number is free text written by a model. Real ones are
           short; anything long is either a mistake or someone using plant
           storage as a notepad, and it is the plant paying the gas. */
        uint256 len = bytes(partNo).length;
        if (len == 0 || len > 40) revert BadPartNo();

        bytes32 line = _lineKey(machineId, partNo);
        if (_openLine[line]) revert AlreadyOnOrder();
        _openLine[line] = true;

        id = _pos.length;
        _pos.push(
            PO({
                supplier: supplier,
                since: uint40(block.timestamp),
                status: Status.Proposed,
                agentFunded: false,
                machineId: machineId,
                rulHoursAtOrder: rulHoursAtOrder,
                amount: amount,
                deliveryRef: bytes32(0),
                partNo: partNo
            })
        );
        emit Proposed(id, machineId, supplier, amount, partNo);

        if (amount <= autoApproveMax) _fund(id, true);
    }

    /// @notice Human authority funds a PO the agent could not fund alone.
    function approvePO(uint256 id) external onlyPlant {
        _fund(id, false);
    }

    function _fund(uint256 id, bool autonomous) private {
        PO storage po = _pos[id];
        if (po.status != Status.Proposed) revert BadStatus();
        if (po.amount > available) revert Underfunded();

        if (autonomous) {
            // ponytail: hard window reset, not a rolling 30d sum. A quiet month
            // does not carry budget forward — swap for a bucketed sum if a
            // plant ever needs that.
            if (block.timestamp >= windowStart + BUDGET_WINDOW) {
                windowStart = uint40(block.timestamp);
                spentInWindow = 0;
            }
            if (spentInWindow + po.amount > monthlyCap) revert CapExceeded();
            spentInWindow += po.amount;
            po.agentFunded = true;
        }

        available -= po.amount;
        escrowed += po.amount;
        po.status = Status.Funded;
        po.since = uint40(block.timestamp);
        emit Funded(id, po.amount, autonomous);
    }

    /// @notice Supplier despatches, committing to the document that proves it.
    /// @param deliveryRef Hash of the waybill or consignment note.
    function markShipped(uint256 id, bytes32 deliveryRef) external {
        PO storage po = _pos[id];
        if (msg.sender != po.supplier) revert NotSupplier();
        if (po.status != Status.Funded) revert BadStatus();
        if (deliveryRef == bytes32(0)) revert NoDeliveryRef();

        po.status = Status.Shipped;
        po.since = uint40(block.timestamp);
        po.deliveryRef = deliveryRef;
        emit Shipped(id, deliveryRef);
    }

    /**
     * @notice Plant books the goods in; escrow goes to the supplier.
     * @param deliveryRef The reference read off the document that arrived with
     * the parts. Once a supplier has despatched, this must match what they
     * committed to — so funds are released against a checked document rather
     * than a bare click. Ignored when the supplier never marked despatch and
     * the plant is settling directly, which is the plant's own call.
     */
    function confirmReceipt(uint256 id, bytes32 deliveryRef) external onlyPlant {
        PO storage po = _pos[id];
        if (po.status == Status.Shipped) {
            if (deliveryRef != po.deliveryRef) revert DeliveryRefMismatch();
        } else if (po.status != Status.Funded) {
            revert BadStatus();
        }
        _release(id, po);
    }

    /// @notice Supplier collects after shipping if the plant stays silent.
    function claimAfterTimeout(uint256 id) external {
        PO storage po = _pos[id];
        if (msg.sender != po.supplier) revert NotSupplier();
        if (po.status != Status.Shipped) revert BadStatus();
        if (block.timestamp < po.since + RECEIPT_TIMEOUT) revert TooEarly();
        _release(id, po);
    }

    /// @dev Identifies a machine-and-part line, which may hold one open order.
    function _lineKey(uint32 machineId, string memory partNo) private pure returns (bytes32) {
        return keccak256(abi.encode(machineId, partNo));
    }

    function _release(uint256 id, PO storage po) private {
        uint128 amount = po.amount;
        address supplier = po.supplier;
        po.status = Status.Released;
        po.since = uint40(block.timestamp);
        _openLine[_lineKey(po.machineId, po.partNo)] = false;
        escrowed -= amount;
        token.safeTransfer(supplier, amount);
        emit Released(id, supplier, amount);
    }

    /**
     * @notice Issue a delivered part from the store to the machine.
     *
     * Goods receipt is only half of stock control. Without this a part that
     * arrived and was fitted still counts as sitting on the shelf, the store
     * looks fuller every delivery, and the agent eventually stops ordering
     * anything at all.
     */
    function fitPart(uint256 id) external onlyPlant {
        PO storage po = _pos[id];
        if (po.status != Status.Released) revert BadStatus();
        po.status = Status.Fitted;
        po.since = uint40(block.timestamp);
        emit Fitted(id, po.machineId, po.partNo);
    }

    /**
     * @notice Clear a proposal nobody answered, freeing its line.
     *
     * Permissionless on purpose: a Proposed order holds no money, so there is
     * nothing to steal by expiring one, and requiring the plant to do it is
     * how the line gets blocked in the first place.
     */
    function expireProposal(uint256 id) external {
        if (id >= _pos.length) revert BadStatus();
        PO storage po = _pos[id];
        if (po.status != Status.Proposed) revert BadStatus();
        if (block.timestamp < po.since + PROPOSAL_TTL) revert TooEarly();

        po.status = Status.Cancelled;
        po.since = uint40(block.timestamp);
        _openLine[_lineKey(po.machineId, po.partNo)] = false;
        emit Cancelled(id, 0);
    }

    /// @notice Plant kills a PO before the supplier ships. Budget is returned
    /// to the agent so one cancelled order does not lock it out for a month.
    function cancelPO(uint256 id) external onlyPlant {
        PO storage po = _pos[id];
        if (po.status != Status.Proposed && po.status != Status.Funded) revert BadStatus();

        uint128 refunded = 0;
        if (po.status == Status.Funded) {
            refunded = po.amount;
            escrowed -= refunded;
            available += refunded;

            // Only give budget back if it was spent from the window that is
            // still running. Cancelling an order funded under a previous
            // window would otherwise hand the agent allowance it never used
            // this window.
            bool sameWindow = po.since >= windowStart;
            if (po.agentFunded && sameWindow && spentInWindow >= refunded) {
                spentInWindow -= refunded;
            }
        }
        po.status = Status.Cancelled;
        po.since = uint40(block.timestamp);
        _openLine[_lineKey(po.machineId, po.partNo)] = false;
        emit Cancelled(id, refunded);
    }

    // --- views ---

    function poCount() external view returns (uint256) {
        return _pos.length;
    }

    /// @notice Whether this machine already has an order open for this part.
    function isOnOrder(uint32 machineId, string calldata partNo) external view returns (bool) {
        return _openLine[_lineKey(machineId, partNo)];
    }

    function getPO(uint256 id) external view returns (PO memory) {
        return _pos[id];
    }

    /// @dev ponytail: unbounded read, fine at demo scale. Read events instead
    /// once a plant has thousands of POs.
    function allPOs() external view returns (PO[] memory) {
        return _pos;
    }
}
