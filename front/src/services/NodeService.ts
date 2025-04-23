import { NodeApiHttpClient } from "hyle";

class NodeService {
  client: NodeApiHttpClient;

  constructor() {
    this.client = new NodeApiHttpClient(import.meta.env.VITE_NODE_BASE_URL);
  }

  async getBalance(address: string): Promise<number> {
    interface BalanceResponse {
      balance: number;
    }
    const balance: BalanceResponse = await this.client.get(
      "v1/indexer/contract/hyllar/balance/" + address,
      "get balance",
    );
    console.log("Balance:", balance);
    return balance.balance;
  }
}

export const nodeService = new NodeService();
