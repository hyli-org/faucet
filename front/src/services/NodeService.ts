import {
  BlobTransaction,
  IndexerApiHttpClient,
  NodeApiHttpClient,
  TxHash,
} from "hyli";

class NodeService {
  client: NodeApiHttpClient;
  indexer: IndexerApiHttpClient;
  server: IndexerApiHttpClient;

  constructor() {
    this.client = new NodeApiHttpClient(import.meta.env.VITE_NODE_BASE_URL);
    this.indexer = new IndexerApiHttpClient(
      import.meta.env.VITE_INDEXER_BASE_URL,
    );
    this.server = new IndexerApiHttpClient(
      import.meta.env.VITE_SERVER_BASE_URL,
    );
  }

  async sendBlobTx(tx: BlobTransaction): Promise<TxHash> {
    if (!window.apiKey) {
      return this.client.sendBlobTx(tx);
    }
    const headers = new Headers();
    headers.append("x-api-key", window.apiKey);
    headers.append("Content-Type", "application/json");
    const requestOptions: RequestInit = {
      method: "POST",
      headers: headers,
      body: JSON.stringify(tx),
      redirect: "follow",
    };
    const response = await fetch(
      import.meta.env.VITE_NODE_BASE_URL + "/v1/tx/send/blob",
      requestOptions,
    );
    if (!response.ok) {
      throw new Error("Failed to send blob transaction");
    }

    return response.json();
  }

  async getBalance(address: string): Promise<number> {
    const balance: number = await this.server.get(
      "v1/indexer/contract/faucet/balance/" + address,
      "get balance",
    );
    console.log("Balance:", balance);
    return balance;
  }
}

export const nodeService = new NodeService();
