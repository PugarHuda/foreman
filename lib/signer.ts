/**
 * Where a role's signature comes from.
 *
 * The demo holds private keys in environment variables, which is what makes
 * it a demo: anything that can read the environment can spend up to the
 * on-chain cap. A pilot with real money puts the key in a KMS.
 *
 * Rather than pick a cloud vendor, this speaks to a signing service over
 * HTTP: it sends a 32-byte digest and expects a 65-byte signature back. AWS
 * KMS, GCP KMS, Vault, Fireblocks and an HSM in a rack all fit behind that,
 * and none of their SDKs end up in this repo.
 *
 *   POST $AGENT_SIGNER_URL
 *   { "role": "agent", "digest": "0x…32 bytes" }
 *   -> { "signature": "0x…65 bytes" }
 *
 * The service returns a complete signature including the recovery byte. That
 * is deliberate: raw KMS returns r and s only, and recovering v means trying
 * both and checking which yields the expected address — vendor-shaped work
 * that belongs next to the vendor, not here.
 *
 * ponytail: no retries and no request signing on this hop. The signer is
 * expected to be reachable over a private network or a mesh; if yours is not,
 * mTLS on the transport is the answer, not a token in this file.
 */
import {
  hashMessage,
  hashTypedData,
  keccak256,
  serializeTransaction,
  type Account,
  type Address,
  type Hex,
} from "viem";
import { toAccount } from "viem/accounts";

export type Role = "plant" | "agent" | "supplierA" | "supplierB";

/** Per-role first, then a shared endpoint — most deployments have one signer. */
const signerUrl = (role: Role) =>
  process.env[`${role.toUpperCase()}_SIGNER_URL`] ?? process.env.REMOTE_SIGNER_URL;

const signerAddress = (role: Role) =>
  process.env[`${role.toUpperCase()}_SIGNER_ADDRESS`] as Address | undefined;

export const usesRemoteSigner = (role: Role) => Boolean(signerUrl(role) && signerAddress(role));

async function signDigest(role: Role, url: string, digest: Hex): Promise<Hex> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, digest }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`signer for ${role}: ${res.status} ${(await res.text()).slice(0, 160)}`);
  }
  const { signature } = (await res.json()) as { signature?: string };

  /* A signature of the wrong length is not a signature. Checked here because
     the failure downstream is a transaction that reverts or, worse, one that
     recovers to an address the contract does not know. */
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new Error(`signer for ${role} returned no usable 65-byte signature`);
  }
  return signature as Hex;
}

/**
 * A viem account backed by the signing service.
 *
 * Only `signTransaction` is exercised by this app; the other two are here
 * because an account that silently cannot sign a message is a trap for
 * whoever adds the next feature.
 */
export function remoteAccount(role: Role): Account {
  const url = signerUrl(role)!;
  const address = signerAddress(role)!;

  return toAccount({
    address,
    async signMessage({ message }) {
      return signDigest(role, url, hashMessage(message));
    },
    async signTransaction(transaction, options) {
      const serializer = options?.serializer ?? serializeTransaction;
      const signature = await signDigest(role, url, keccak256(await serializer(transaction)));
      return serializer(transaction, {
        r: `0x${signature.slice(2, 66)}` as Hex,
        s: `0x${signature.slice(66, 130)}` as Hex,
        // Both encodings are in the wild; viem wants yParity for typed txs.
        yParity: Number.parseInt(signature.slice(130, 132), 16) % 2,
      });
    },
    async signTypedData(typedData) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return signDigest(role, url, hashTypedData(typedData as any));
    },
  });
}
