import { Connection, PublicKey, AccountInfo, ParsedAccountData } from "@solana/web3.js";
import { Telegraf } from "telegraf";

// Solana configuration
const SOLANA_WS_URL = "wss://api.mainnet-beta.solana.com";
const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
let connection = new Connection(SOLANA_RPC_URL, "confirmed");

// Telegram Bot configuration
const BOT_TOKEN = "7927451768:AAEfIjHousM73AMxZ-5p0tEwdSiQ-RVidOQ";
const CHAT_ID = "7397808810";
if (!BOT_TOKEN || !CHAT_ID) {
  throw new Error("BOT_TOKEN or CHAT_ID is missing.");
}
const bot = new Telegraf(BOT_TOKEN);

// Wallets to track
const WALLET_ADDRESSES = [
  "2UWHq9JNxnBi4ehpfivh9crJjG5EuayKCWsH9VuLXPeR",
  "AEHqTB2RtJjegsR2ePjvoJSm6AA5pnYKWVbcsn6kqTBD",
];

// Helper function to send Telegram messages
async function sendTelegramMessage(message: string): Promise<void> {
  try {
    await bot.telegram.sendMessage(CHAT_ID, message);
    console.log("Message sent to Telegram.");
  } catch (error) {
    console.error("Failed to send Telegram message:", error);
  }
}

// Fetch recent transactions for a wallet
async function fetchRecentTransactions(walletAddress: string): Promise<string[]> {
  const publicKey = new PublicKey(walletAddress);

  try {
    const confirmedSignatures = await connection.getSignaturesForAddress(publicKey, { limit: 1 });
    if (confirmedSignatures.length === 0) {
      return ["No recent transactions found."];
    }

    const recentSignature = confirmedSignatures[0].signature;
    const transaction = await connection.getParsedTransaction(recentSignature, {
      commitment: "confirmed",
    });

    if (transaction) {
      const { slot, meta } = transaction;
      const fee = meta?.fee ? meta.fee / 1e9 : 0; // Convert lamports to SOL
      const preBalances = meta?.preBalances || [];
      const postBalances = meta?.postBalances || [];
      const blockTime = transaction.blockTime ? new Date(transaction.blockTime * 1000).toLocaleString() : "N/A";

      const preBalancesFormatted = preBalances.map((b: number) => (b / 1e9).toFixed(8));
      const postBalancesFormatted = postBalances.map((b: number) => (b / 1e9).toFixed(8));

      return [
        `Slot: ${slot}`,
        `Timestamp: ${blockTime}`,
        `Fee: ${fee.toFixed(8)} SOL`,
        `Pre-Transaction Balances: ${preBalancesFormatted.join(", ")}`,
        `Post-Transaction Balances: ${postBalancesFormatted.join(", ")}`,
      ];
    } else {
      return ["Unable to fetch transaction details."];
    }
  } catch (error) {
    console.error(`Failed to fetch transactions for ${walletAddress}:`, error);
    return ["Error fetching transaction details."];
  }
}

// Fetch token balances for a wallet
async function fetchTokenBalances(walletAddress: string): Promise<string[]> {
  const publicKey = new PublicKey(walletAddress);
  const tokenAccounts = await connection.getTokenAccountsByOwner(publicKey, {
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  });

  const tokenBalances: string[] = [];
  for (const accountInfo of tokenAccounts.value) {
    const parsedData = await connection.getParsedAccountInfo(new PublicKey(accountInfo.pubkey));
    const parsedInfo = (parsedData?.value?.data as ParsedAccountData)?.parsed?.info;
    if (parsedInfo) {
      const { mint, tokenAmount } = parsedInfo;
      tokenBalances.push(`Token: ${mint}, Balance: ${tokenAmount.uiAmountString}`);
    }
  }

  return tokenBalances;
}

// Monitor WebSocket and handle disconnection
async function monitorConnection() {
  try {
    console.log("Monitoring WebSocket connection...");
    const version = await connection.getVersion(); // A test call to confirm connection
    console.log(`Connection is valid. Solana version: ${version["solana-core"]}`);
  } catch (error) {
    console.error("Connection lost. Attempting to reconnect...");
    connection = new Connection(SOLANA_RPC_URL, "confirmed"); // Reinitialize connection
    await startTrackingWallets(); // Restart wallet tracking
  }
}

// Subscribe to account updates via WebSocket
async function subscribeToAccountUpdates(walletAddress: string) {
  const publicKey = new PublicKey(walletAddress);

  connection.onAccountChange(publicKey, async (accountInfo: AccountInfo<Buffer>) => {
    const lamports = accountInfo.lamports;
    const balance = lamports / 1e9; // Convert lamports to SOL

    let message = `🔔 **Dynamic Update** 🔔\nWallet: ${walletAddress}\nSOL Balance: ${balance.toFixed(8)} SOL\n`;

    try {
      const tokenBalances = await fetchTokenBalances(walletAddress);
      message += `\nToken Balances:\n${tokenBalances.join("\n")}`;
    } catch (error) {
      console.error(`Failed to fetch token balances for ${walletAddress}:`, error);
    }

    try {
      const transactionDetails = await fetchRecentTransactions(walletAddress);
      message += `\nRecent Transaction Details:\n${transactionDetails.join("\n")}`;
    } catch (error) {
      console.error(`Failed to fetch recent transactions for ${walletAddress}:`, error);
    }

    console.log(message);
    await sendTelegramMessage(message);
  });
}

// Start tracking wallets
async function startTrackingWallets() {
  console.log("Connected to Solana WebSocket API");

  for (const walletAddress of WALLET_ADDRESSES) {
    console.log(`Subscribing to updates for wallet: ${walletAddress}`);
    try {
      await subscribeToAccountUpdates(walletAddress);
    } catch (error) {
      console.error(`Error during subscription for wallet ${walletAddress}:`, error);
    }
  }
}

// Main function
async function main() {
  console.log("Starting Solana Wallet Tracker...");
  await startTrackingWallets();
  console.log("Wallet tracking initialized.");

  // Monitor WebSocket connection periodically
  setInterval(monitorConnection, 30 * 1000); // Check connection every 30 seconds
}

main().catch((error) => console.error("Error in tracking:", error));
