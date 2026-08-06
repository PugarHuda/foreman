import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";

const { viem, networkHelpers } = await network.connect();

const usdc = (n: number) => BigInt(Math.round(n * 1e6));
const CAP = usdc(2_000); // agent may commit this much per 30d window
const AUTO = usdc(500); // per-PO autonomous ceiling
const DEPOSIT = usdc(50_000);

/** Stand-in for the hash of a carrier's waybill. */
const REF = "0x" + "a1".repeat(32) as `0x${string}`;
const OTHER_REF = "0x" + "b2".repeat(32) as `0x${string}`;
const NO_REF = ("0x" + "00".repeat(32)) as `0x${string}`;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

const Status = {
  Proposed: 1,
  Funded: 2,
  Shipped: 3,
  Released: 4,
  Cancelled: 5,
  Fitted: 6,
} as const;

async function deploy() {
  const [plant, agent, supplier, outsider] = await viem.getWalletClients();
  const token = await viem.deployContract("MockUSDC");
  const foreman = await viem.deployContract("Foreman", [
    token.address,
    agent.account.address,
    CAP,
    AUTO,
  ]);

  await token.write.mint([plant.account.address, DEPOSIT]);
  await token.write.approve([foreman.address, DEPOSIT], { account: plant.account });
  await foreman.write.deposit([DEPOSIT], { account: plant.account });
  await foreman.write.setSupplier([supplier.account.address, true], { account: plant.account });

  return { plant, agent, supplier, outsider, token, foreman };
}

async function expectRevert(p: Promise<unknown>, name: string) {
  try {
    await p;
  } catch (e) {
    assert.match(String(e), new RegExp(name), `expected ${name}, got: ${e}`);
    return;
  }
  assert.fail(`expected revert ${name}, but the call succeeded`);
}

describe("Foreman", () => {
  it("funds a routine PO autonomously and draws it from the agent budget", async () => {
    const { agent, supplier, foreman } = await deploy();

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });

    const po = await foreman.read.getPO([0n]);
    assert.equal(po.status, Status.Funded, "routine PO should skip the human queue");
    assert.equal(await foreman.read.escrowed(), usdc(180));
    assert.equal(await foreman.read.available(), DEPOSIT - usdc(180));
    assert.equal(await foreman.read.remainingBudget(), CAP - usdc(180));
  });

  it("holds a PO above the auto-approve line until a human approves", async () => {
    const { plant, agent, supplier, foreman } = await deploy();
    const spindle = usdc(4_000);

    await foreman.write.proposePO([7, "SPN-880", supplier.account.address, spindle, 35], {
      account: agent.account,
    });
    assert.equal((await foreman.read.getPO([0n])).status, Status.Proposed);
    assert.equal(await foreman.read.escrowed(), 0n, "nothing moves before approval");

    await foreman.write.approvePO([0n], { account: plant.account });
    assert.equal((await foreman.read.getPO([0n])).status, Status.Funded);
    assert.equal(await foreman.read.escrowed(), spindle);
    assert.equal(
      await foreman.read.remainingBudget(),
      CAP,
      "human approval must not consume the agent budget",
    );
  });

  it("stops the agent at the monthly cap and reopens the budget a window later", async () => {
    const { agent, supplier, foreman } = await deploy();

    for (let i = 0; i < 4; i++) {
      await foreman.write.proposePO([7, `PART-${i}`, supplier.account.address, AUTO, 58], {
        account: agent.account,
      });
    }
    assert.equal(await foreman.read.remainingBudget(), 0n);

    await expectRevert(
      foreman.write.proposePO([7, "PART-X", supplier.account.address, usdc(1), 58], {
        account: agent.account,
      }),
      "CapExceeded",
    );

    await networkHelpers.time.increase(31 * 24 * 60 * 60);
    assert.equal(await foreman.read.remainingBudget(), CAP);
    await foreman.write.proposePO([7, "PART-X", supplier.account.address, usdc(1), 58], {
      account: agent.account,
    });
    assert.equal((await foreman.read.getPO([4n])).status, Status.Funded);
  });

  it("pays the supplier on confirmed receipt", async () => {
    const { plant, agent, supplier, token, foreman } = await deploy();

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });
    await foreman.write.markShipped([0n, REF], { account: supplier.account });
    assert.equal((await foreman.read.getPO([0n])).status, Status.Shipped);

    await foreman.write.confirmReceipt([0n, REF], { account: plant.account });

    assert.equal(await token.read.balanceOf([supplier.account.address]), usdc(180));
    assert.equal(await foreman.read.escrowed(), 0n);
    assert.equal((await foreman.read.getPO([0n])).status, Status.Released);
  });

  it("will not release escrow against a document nobody committed to", async () => {
    const { plant, agent, supplier, foreman } = await deploy();

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });

    // A despatch has to reference something.
    await expectRevert(
      foreman.write.markShipped([0n, NO_REF], { account: supplier.account }),
      "NoDeliveryRef",
    );

    await foreman.write.markShipped([0n, REF], { account: supplier.account });
    assert.equal((await foreman.read.getPO([0n])).deliveryRef, REF, "the reference is on chain");

    // Goods-in reading a different document must not free the money.
    await expectRevert(
      foreman.write.confirmReceipt([0n, OTHER_REF], { account: plant.account }),
      "DeliveryRefMismatch",
    );

    await foreman.write.confirmReceipt([0n, REF], { account: plant.account });
    assert.equal((await foreman.read.getPO([0n])).status, Status.Released);
  });

  it("still lets the plant settle an order the supplier never marked despatched", async () => {
    const { plant, agent, supplier, token, foreman } = await deploy();

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });
    // Parts turned up without paperwork; the plant's own money, the plant's call.
    await foreman.write.confirmReceipt([0n, NO_REF], { account: plant.account });
    assert.equal(await token.read.balanceOf([supplier.account.address]), usdc(180));
  });

  it("lets a shipped supplier collect after the receipt timeout, but not before", async () => {
    const { agent, supplier, token, foreman } = await deploy();

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });
    await foreman.write.markShipped([0n, REF], { account: supplier.account });

    await expectRevert(
      foreman.write.claimAfterTimeout([0n], { account: supplier.account }),
      "TooEarly",
    );

    await networkHelpers.time.increase(15 * 24 * 60 * 60);
    await foreman.write.claimAfterTimeout([0n], { account: supplier.account });
    assert.equal(await token.read.balanceOf([supplier.account.address]), usdc(180));
  });

  it("returns escrow and budget when the plant cancels a funded PO", async () => {
    const { plant, agent, supplier, foreman } = await deploy();

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });
    await foreman.write.cancelPO([0n], { account: plant.account });

    assert.equal((await foreman.read.getPO([0n])).status, Status.Cancelled);
    assert.equal(await foreman.read.escrowed(), 0n);
    assert.equal(await foreman.read.available(), DEPOSIT);
    assert.equal(await foreman.read.remainingBudget(), CAP, "cancelling must not burn budget");
  });

  it("does not hand back budget from a window that has already rolled", async () => {
    const { plant, agent, supplier, foreman } = await deploy();

    // Spend most of the window, then let it roll over.
    await foreman.write.proposePO([7, "OLD", supplier.account.address, AUTO, 58], {
      account: agent.account,
    });
    await networkHelpers.time.increase(31 * 24 * 60 * 60);
    assert.equal(await foreman.read.remainingBudget(), CAP);

    // Spend more in the fresh window than the old order was worth.
    await foreman.write.proposePO([7, "NEW-A", supplier.account.address, AUTO, 58], {
      account: agent.account,
    });
    await foreman.write.proposePO([7, "NEW-B", supplier.account.address, AUTO, 58], {
      account: agent.account,
    });
    const spentThisWindow = await foreman.read.spentInWindow();
    assert.equal(spentThisWindow, AUTO * 2n);

    // Cancelling the stale order must not credit this window's budget.
    await foreman.write.cancelPO([0n], { account: plant.account });
    assert.equal(
      await foreman.read.spentInWindow(),
      spentThisWindow,
      "budget from a previous window must not be refunded into this one",
    );
    assert.equal(await foreman.read.available(), DEPOSIT - AUTO * 2n, "escrow still comes back");
  });

  it("refuses a cancelled PO a second time and blocks shipping it", async () => {
    const { plant, agent, supplier, foreman } = await deploy();

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });
    await foreman.write.cancelPO([0n], { account: plant.account });

    await expectRevert(foreman.write.cancelPO([0n], { account: plant.account }), "BadStatus");
    await expectRevert(
      foreman.write.markShipped([0n, REF], { account: supplier.account }),
      "BadStatus",
    );
  });

  it("keeps outsiders out of the agent and plant lanes", async () => {
    const { plant, agent, supplier, outsider, foreman } = await deploy();

    await expectRevert(
      foreman.write.proposePO([7, "X", supplier.account.address, usdc(10), 58], {
        account: outsider.account,
      }),
      "NotAgent",
    );
    await expectRevert(
      foreman.write.proposePO([7, "X", supplier.account.address, usdc(10), 58], {
        account: plant.account,
      }),
      "NotAgent",
    );

    await foreman.write.proposePO([7, "X", supplier.account.address, usdc(4_000), 58], {
      account: agent.account,
    });
    await expectRevert(foreman.write.approvePO([0n], { account: agent.account }), "NotPlant");
    await expectRevert(
      foreman.write.withdraw([usdc(1)], { account: outsider.account }),
      "NotPlant",
    );

    await foreman.write.approvePO([0n], { account: plant.account });
    await expectRevert(
      foreman.write.markShipped([0n, REF], { account: outsider.account }),
      "NotSupplier",
    );
  });

  it("refuses a second open order for the same machine and part", async () => {
    const { plant, agent, supplier, foreman } = await deploy();

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });
    assert.equal(await foreman.read.isOnOrder([7, "6205-2RS"]), true);

    // The agent misreading its own order book must not cost the plant twice.
    await expectRevert(
      foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
        account: agent.account,
      }),
      "AlreadyOnOrder",
    );

    // A different part on the same machine is a different line.
    await foreman.write.proposePO([7, "SPN-880", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });
    // So is the same part on a different machine.
    await foreman.write.proposePO([11, "6205-2RS", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });
    assert.equal(await foreman.read.poCount(), 3n);
  });

  it("reopens the line once the order is settled or dropped", async () => {
    const { plant, agent, supplier, foreman } = await deploy();

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });
    await foreman.write.markShipped([0n, REF], { account: supplier.account });
    await foreman.write.confirmReceipt([0n, REF], { account: plant.account });
    assert.equal(await foreman.read.isOnOrder([7, "6205-2RS"]), false, "delivered frees the line");

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });
    await foreman.write.cancelPO([1n], { account: plant.account });
    assert.equal(await foreman.read.isOnOrder([7, "6205-2RS"]), false, "cancelled frees the line");

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });
    assert.equal(await foreman.read.poCount(), 3n);
  });

  it("issues a delivered part to the machine, and only once", async () => {
    const { plant, agent, supplier, foreman } = await deploy();

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });
    await expectRevert(foreman.write.fitPart([0n], { account: plant.account }), "BadStatus");

    await foreman.write.markShipped([0n, REF], { account: supplier.account });
    await foreman.write.confirmReceipt([0n, REF], { account: plant.account });

    await foreman.write.fitPart([0n], { account: plant.account });
    assert.equal((await foreman.read.getPO([0n])).status, Status.Fitted);

    await expectRevert(foreman.write.fitPart([0n], { account: plant.account }), "BadStatus");
    await expectRevert(foreman.write.fitPart([0n], { account: agent.account }), "NotPlant");
  });

  it("records what the order was worth when it was placed", async () => {
    const { agent, supplier, foreman } = await deploy();

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });
    assert.equal(
      (await foreman.read.getPO([0n])).rulHoursAtOrder,
      58,
      "the projection at order time is fixed, not recomputed later",
    );
  });

  it("hands the plant role over in two steps, so a typo cannot lock the treasury", async () => {
    const { plant, agent, supplier, outsider, foreman } = await deploy();

    await expectRevert(
      foreman.write.nominatePlant([outsider.account.address], { account: agent.account }),
      "NotPlant",
    );

    const currentPlant = async () => (await foreman.read.plant()).toLowerCase();

    await foreman.write.nominatePlant([outsider.account.address], { account: plant.account });
    assert.equal(
      await currentPlant(),
      plant.account.address.toLowerCase(),
      "nothing moves on nomination",
    );

    // Only the nominee can complete it — proving the key actually signs.
    await expectRevert(foreman.write.acceptPlant({ account: agent.account }), "NotNominated");

    await foreman.write.acceptPlant({ account: outsider.account });
    assert.equal(await currentPlant(), outsider.account.address.toLowerCase());

    // Authority really moved.
    await expectRevert(
      foreman.write.setSupplier([supplier.account.address, false], { account: plant.account }),
      "NotPlant",
    );
    await foreman.write.setSupplier([supplier.account.address, false], {
      account: outsider.account,
    });
  });

  it("only lets the plant top up the treasury", async () => {
    const { outsider, token, foreman } = await deploy();

    await token.write.mint([outsider.account.address, usdc(100)]);
    await token.write.approve([foreman.address, usdc(100)], { account: outsider.account });
    await expectRevert(
      foreman.write.deposit([usdc(100)], { account: outsider.account }),
      "NotPlant",
    );
  });

  it("lets an unanswered proposal lapse so the line is not blocked for good", async () => {
    const { agent, supplier, outsider, foreman } = await deploy();
    const spindle = usdc(4_000);

    await foreman.write.proposePO([7, "SPN-880", supplier.account.address, spindle, 35], {
      account: agent.account,
    });
    assert.equal(await foreman.read.isOnOrder([7, "SPN-880"]), true);

    // Nobody approved or rejected it, and the agent is now locked out.
    await expectRevert(
      foreman.write.proposePO([7, "SPN-880", supplier.account.address, spindle, 20], {
        account: agent.account,
      }),
      "AlreadyOnOrder",
    );
    await expectRevert(foreman.write.expireProposal([0n], { account: outsider.account }), "TooEarly");

    await networkHelpers.time.increase(8 * 24 * 60 * 60);

    // Permissionless: nothing is escrowed on a proposal, so anyone may clear it.
    await foreman.write.expireProposal([0n], { account: outsider.account });
    assert.equal((await foreman.read.getPO([0n])).status, Status.Cancelled);
    assert.equal(await foreman.read.isOnOrder([7, "SPN-880"]), false);
    assert.equal(await foreman.read.escrowed(), 0n, "a proposal never held money");

    await foreman.write.proposePO([7, "SPN-880", supplier.account.address, spindle, 20], {
      account: agent.account,
    });
  });

  it("will not expire an order that money is already behind", async () => {
    const { plant, agent, supplier, outsider, foreman } = await deploy();

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });
    await networkHelpers.time.increase(8 * 24 * 60 * 60);

    // Funded, not Proposed — expiring this would strand escrow.
    await expectRevert(foreman.write.expireProposal([0n], { account: outsider.account }), "BadStatus");
    assert.equal(await foreman.read.escrowed(), usdc(180));
  });

  it("lets the plant call off a handover it has not completed", async () => {
    const { plant, outsider, foreman } = await deploy();

    await foreman.write.nominatePlant([outsider.account.address], { account: plant.account });
    await foreman.write.nominatePlant([ZERO], { account: plant.account });

    await expectRevert(foreman.write.acceptPlant({ account: outsider.account }), "NotNominated");
    assert.equal(
      (await foreman.read.plant()).toLowerCase(),
      plant.account.address.toLowerCase(),
      "the original key keeps authority",
    );
  });

  it("will not let the model write a novel into plant storage", async () => {
    const { agent, supplier, foreman } = await deploy();

    await expectRevert(
      foreman.write.proposePO([7, "", supplier.account.address, usdc(180), 58], {
        account: agent.account,
      }),
      "BadPartNo",
    );
    await expectRevert(
      foreman.write.proposePO([7, "X".repeat(41), supplier.account.address, usdc(180), 58], {
        account: agent.account,
      }),
      "BadPartNo",
    );

    // A real part number is nowhere near the limit.
    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
      account: agent.account,
    });
    assert.equal((await foreman.read.getPO([0n])).partNo, "6205-2RS");
  });

  it("will not pay an address the plant never vetted", async () => {
    const { plant, agent, supplier, outsider, foreman } = await deploy();

    // The whole premise of an agent holding funds rests on this: even with a
    // valid key and budget to spare, it cannot invent a payee.
    await expectRevert(
      foreman.write.proposePO([7, "6205-2RS", outsider.account.address, usdc(180), 58], {
        account: agent.account,
      }),
      "SupplierNotApproved",
    );

    await foreman.write.setSupplier([outsider.account.address, true], { account: plant.account });
    await foreman.write.proposePO([7, "6205-2RS", outsider.account.address, usdc(180), 58], {
      account: agent.account,
    });
    assert.equal((await foreman.read.getPO([0n])).status, Status.Funded);

    // ...and the plant can withdraw that permission again.
    await foreman.write.setSupplier([supplier.account.address, false], { account: plant.account });
    await expectRevert(
      foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
        account: agent.account,
      }),
      "SupplierNotApproved",
    );
  });

  it("lets only the plant vet a supplier", async () => {
    const { agent, outsider, foreman } = await deploy();

    for (const who of [agent, outsider]) {
      await expectRevert(
        foreman.write.setSupplier([outsider.account.address, true], { account: who.account }),
        "NotPlant",
      );
    }
  });

  it("will not commit more than the plant deposited", async () => {
    const { plant, agent, supplier, foreman } = await deploy();

    await foreman.write.withdraw([DEPOSIT - usdc(100)], { account: plant.account });
    await expectRevert(
      foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180), 58], {
        account: agent.account,
      }),
      "Underfunded",
    );
  });
});
