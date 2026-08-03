import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";

const { viem, networkHelpers } = await network.connect();

const usdc = (n: number) => BigInt(Math.round(n * 1e6));
const CAP = usdc(2_000); // agent may commit this much per 30d window
const AUTO = usdc(500); // per-PO autonomous ceiling
const DEPOSIT = usdc(50_000);

const Status = {
  Proposed: 1,
  Funded: 2,
  Shipped: 3,
  Released: 4,
  Cancelled: 5,
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

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180)], {
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

    await foreman.write.proposePO([7, "SPN-880", supplier.account.address, spindle], {
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
      await foreman.write.proposePO([7, `PART-${i}`, supplier.account.address, AUTO], {
        account: agent.account,
      });
    }
    assert.equal(await foreman.read.remainingBudget(), 0n);

    await expectRevert(
      foreman.write.proposePO([7, "PART-X", supplier.account.address, usdc(1)], {
        account: agent.account,
      }),
      "CapExceeded",
    );

    await networkHelpers.time.increase(31 * 24 * 60 * 60);
    assert.equal(await foreman.read.remainingBudget(), CAP);
    await foreman.write.proposePO([7, "PART-X", supplier.account.address, usdc(1)], {
      account: agent.account,
    });
    assert.equal((await foreman.read.getPO([4n])).status, Status.Funded);
  });

  it("pays the supplier on confirmed receipt", async () => {
    const { plant, agent, supplier, token, foreman } = await deploy();

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180)], {
      account: agent.account,
    });
    await foreman.write.markShipped([0n], { account: supplier.account });
    assert.equal((await foreman.read.getPO([0n])).status, Status.Shipped);

    await foreman.write.confirmReceipt([0n], { account: plant.account });

    assert.equal(await token.read.balanceOf([supplier.account.address]), usdc(180));
    assert.equal(await foreman.read.escrowed(), 0n);
    assert.equal((await foreman.read.getPO([0n])).status, Status.Released);
  });

  it("lets a shipped supplier collect after the receipt timeout, but not before", async () => {
    const { agent, supplier, token, foreman } = await deploy();

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180)], {
      account: agent.account,
    });
    await foreman.write.markShipped([0n], { account: supplier.account });

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

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180)], {
      account: agent.account,
    });
    await foreman.write.cancelPO([0n], { account: plant.account });

    assert.equal((await foreman.read.getPO([0n])).status, Status.Cancelled);
    assert.equal(await foreman.read.escrowed(), 0n);
    assert.equal(await foreman.read.available(), DEPOSIT);
    assert.equal(await foreman.read.remainingBudget(), CAP, "cancelling must not burn budget");
  });

  it("refuses a cancelled PO a second time and blocks shipping it", async () => {
    const { plant, agent, supplier, foreman } = await deploy();

    await foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180)], {
      account: agent.account,
    });
    await foreman.write.cancelPO([0n], { account: plant.account });

    await expectRevert(foreman.write.cancelPO([0n], { account: plant.account }), "BadStatus");
    await expectRevert(
      foreman.write.markShipped([0n], { account: supplier.account }),
      "BadStatus",
    );
  });

  it("keeps outsiders out of the agent and plant lanes", async () => {
    const { plant, agent, supplier, outsider, foreman } = await deploy();

    await expectRevert(
      foreman.write.proposePO([7, "X", supplier.account.address, usdc(10)], {
        account: outsider.account,
      }),
      "NotAgent",
    );
    await expectRevert(
      foreman.write.proposePO([7, "X", supplier.account.address, usdc(10)], {
        account: plant.account,
      }),
      "NotAgent",
    );

    await foreman.write.proposePO([7, "X", supplier.account.address, usdc(4_000)], {
      account: agent.account,
    });
    await expectRevert(foreman.write.approvePO([0n], { account: agent.account }), "NotPlant");
    await expectRevert(
      foreman.write.withdraw([usdc(1)], { account: outsider.account }),
      "NotPlant",
    );

    await foreman.write.approvePO([0n], { account: plant.account });
    await expectRevert(
      foreman.write.markShipped([0n], { account: outsider.account }),
      "NotSupplier",
    );
  });

  it("will not commit more than the plant deposited", async () => {
    const { plant, agent, supplier, foreman } = await deploy();

    await foreman.write.withdraw([DEPOSIT - usdc(100)], { account: plant.account });
    await expectRevert(
      foreman.write.proposePO([7, "6205-2RS", supplier.account.address, usdc(180)], {
        account: agent.account,
      }),
      "Underfunded",
    );
  });
});
