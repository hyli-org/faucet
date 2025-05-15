import { IndexerApiHttpClient, NodeApiHttpClient } from "hyle";

class NodeService {
  client: NodeApiHttpClient;
  indexer: IndexerApiHttpClient;

  constructor() {
    this.client = new NodeApiHttpClient(import.meta.env.VITE_NODE_BASE_URL);
    this.indexer = new IndexerApiHttpClient(
      import.meta.env.VITE_INDEXER_BASE_URL,
    );
  }

  async getBalance(address: string): Promise<number> {
    interface BalanceResponse {
      balance: number;
    }
    const balance: BalanceResponse = await this.indexer.get(
      "v1/indexer/contract/hyllar/balance/" + address,
      "get balance",
    );
    console.log("Balance:", balance);
    return balance.balance;
  }
}

export const nodeService = new NodeService();
