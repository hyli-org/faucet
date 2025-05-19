import { BorshSchema, borshDeserialize, borshSerialize } from "borsher";
import { Blob, StructuredBlobData, structuredBlobDataSchema } from "hyle";

/**
 * TypeScript : équivalent de l’enum Rust `SmtTokenAction`
 */
export type SmtTokenAction =
  | {
      Transfer: {
        sender: String;
        recipient: String;
        amount: bigint;
      };
    }
  | {
      TransferFrom: {
        owner: String;
        spender: String;
        recipient: String;
        amount: bigint;
      };
    }
  | {
      Approve: {
        owner: String;
        spender: String;
        amount: bigint;
      };
    };

/**
 * Schéma Borsh pour `SmtTokenAction`
 */
export const smtTokenActionSchema = BorshSchema.Enum({
  Transfer: BorshSchema.Struct({
    sender: BorshSchema.String,
    recipient: BorshSchema.String,
    amount: BorshSchema.u128,
  }),
  TransferFrom: BorshSchema.Struct({
    owner: BorshSchema.String,
    spender: BorshSchema.String,
    recipient: BorshSchema.String,
    amount: BorshSchema.u128,
  }),
  Approve: BorshSchema.Struct({
    owner: BorshSchema.String,
    spender: BorshSchema.String,
    amount: BorshSchema.u128,
  }),
});

/**
 * Désérialise un tableau d’octets en `SmtTokenAction`
 */
export const deserializeSmtTokenAction = (
  data: number[],
): StructuredBlobData<SmtTokenAction> => {
  return borshDeserialize(
    structuredBlobDataSchema(smtTokenActionSchema),
    new Uint8Array(data),
  ) as StructuredBlobData<SmtTokenAction>;
};

export const serializeSmtTokenAction = (
  action: StructuredBlobData<SmtTokenAction>,
): number[] => {
  return Array.from(
    borshSerialize(structuredBlobDataSchema(smtTokenActionSchema), action),
  );
};

export const transfer = (
  sender: String,
  recipient: String,
  token: string,
  amount: bigint,
  caller: number | null,
): Blob => {
  const action: SmtTokenAction = {
    Transfer: {
      sender,
      recipient,
      amount,
    },
  };

  const structured: StructuredBlobData<SmtTokenAction> = {
    caller: caller ? { 0: caller } : null,
    callees: null,
    parameters: action,
  };

  const blob: Blob = {
    contract_name: token,
    data: serializeSmtTokenAction(structured),
  };
  return blob;
};
