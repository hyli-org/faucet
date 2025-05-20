export interface Transaction {
  id: string;
  type: string;
  amount: number;
  address: string;
  status: string;
  timestamp: number;
}

export interface faucet {
  username: string;
  address: string;
}

import { borshSerialize, BorshSchema, borshDeserialize } from "borsher";
import { Blob, StructuredBlobData, structuredBlobDataSchema } from "hyli";

export let faucetContractName = "faucet"; // Default value that will be updated

export const setfaucetContractName = (name: string) => {
  faucetContractName = name;
};

//
// Types
//

export type Nonced<T> = {
  action: T;
  nonce: number;
};
export const noncedSchema = (schema: BorshSchema) =>
  BorshSchema.Struct({
    action: schema,
    nonce: BorshSchema.u64,
  });

export type FaucetAction =
  | {
      Click: {};
    }
  | {
      BuyPowerup: {
        name: string;
      };
    }
  | {
      Cashout: {};
    };

//
// Builders
//

export const blob_click = (callee: number): Blob => {
  const action: Nonced<FaucetAction> = {
    action: { Click: {} },
    nonce: Date.now(),
  };

  const structured: StructuredBlobData<Nonced<FaucetAction>> = {
    caller: null,
    callees: [{ 0: callee }],
    parameters: action,
  };

  const blob: Blob = {
    contract_name: faucetContractName,
    data: serializeFaucetAction(structured),
  };
  return blob;
};

// export const blob_buy_powerup = (name: string): Blob => {
//   const action: Nonced<FaucetAction> = {
//     action: { BuyPowerup: { name } },
//     nonce: Date.now(),
//   };
//
//   const blob: Blob = {
//     contract_name: faucetContractName,
//     data: serializeFaucetAction(action),
//   };
//   return blob;
// };

//
// Serialisation
//

const serializeFaucetAction = (
  action: StructuredBlobData<Nonced<FaucetAction>>,
): number[] => {
  return Array.from(
    borshSerialize(structuredBlobDataSchema(noncedSchema(schema)), action),
  );
};
export const deserializeFaucetAction = (
  data: number[],
): StructuredBlobData<Nonced<FaucetAction>> => {
  return borshDeserialize(
    structuredBlobDataSchema(noncedSchema(schema)),
    Buffer.from(data),
  );
};

const schema = BorshSchema.Enum({
  Click: BorshSchema.Unit,
  BuyPowerup: BorshSchema.Struct({
    name: BorshSchema.String,
  }),
  Cashout: BorshSchema.Unit,
});
