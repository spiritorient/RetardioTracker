import { 
  Connection, 
  PublicKey, 
  AccountInfo, 
  ParsedAccountData, 
  ParsedTransactionWithMeta 
} from "@solana/web3.js";
import { Telegraf } from "telegraf";

// -------------------
// Solana configuration
// -------------------
const SOLANA_WS_URL = "wss://api.mainnet-beta.solana.com";
const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";

// Create a new connection with "confirmed" commitment
let connection = new Connection(SOLANA_RPC_URL, "confirmed");

// --------------------------------
// Telegram Bot configuration
// --------------------------------
const BOT_TOKEN = "7927451768:AAEfIjHousM73AMxZ-5p0tEwdSiQ-RVidOQ";
const CHAT_IDS = [
  "7397808810",
  "7739753477"
];

if (!BOT_TOKEN || CHAT_IDS.length === 0) {
  throw new Error("BOT_TOKEN or CHAT_IDS are missing.");
}
const bot = new Telegraf(BOT_TOKEN);

// -------------------
// Wallets to track
// -------------------
const WALLET_ADDRESSES = [
  "2UWHq9JNxnBi4ehpfivh9crJjG5EuayKCWsH9VuLXPeR",
  "AEHqTB2RtJjegsR2ePjvoJSm6AA5pnYKWVbcsn6kqTBD",
];

// ---------------------------------------------------
// List of known SWAP or DEX program IDs (example set)
// ---------------------------------------------------
const KNOWN_SWAP_PROGRAM_IDS = [
  // Raydium's AMM program (example; you must verify)
  "RVKd61ztZW9VYGrgzeXkqUyXTN4C2xz7RtXnYmAB3Jo",
  // Serum DEX
  "9xQeWvG816bUx9EPv6gSuE7iEEh7ouE9Z2w2n7aM6bZX",
  // Jupiter aggregator
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",
  // Orca swaps
  "9W5kdiR2b1aGZTVysb3tYZkzDU5QbBhAsCRc5Qugosxh",
  // ... add more program IDs here as needed
];

// -----------------------------------------------------
// Helper function to send Telegram messages
// -----------------------------------------------------
async function sendTelegramMessage(message: string): Promise<void> {
  try {
    for (const chatId of CHAT_IDS) {
      await bot.telegram.sendMessage(chatId, message);
      console.log(`[Telegram] Message sent successfully to Chat ID: ${chatId}`);
    }
  } catch (error) {
    console.error("[Telegram] Failed to send message:", error);
  }
}

// -----------------------------------------------------------------
// Fetch the single most recent transaction for a wallet
// and detect if it is a swap by analyzing the program IDs
// -----------------------------------------------------------------
async function fetchRecentTransactions(walletAddress: string): Promise<string[]> {
  const publicKey = new PublicKey(walletAddress);

  try {
    const signatures = await connection.getSignaturesForAddress(publicKey, { limit: 1 });
    if (signatures.length === 0) {
      return ["No recent transactions found."];
    }

    const recentSignature = signatures[0].signature;
    const transaction = await connection.getParsedTransaction(recentSignature, {
      commitment: "confirmed",
    });

    if (!transaction) {
      return ["Unable to fetch transaction details."];
    }

    return formatTransactionDetails(transaction);
  } catch (error) {
    console.error(`Failed to fetch transactions for ${walletAddress}:`, error);
    return ["Error fetching transaction details."];
  }
}

// ---------------------------------------------------------
// Format transaction details and detect if a swap occurred
// ---------------------------------------------------------
function formatTransactionDetails(tx: ParsedTransactionWithMeta): string[] {
  const { slot, transaction, meta, blockTime } = tx;
  const feeLamports = meta?.fee ?? 0;
  const feeSOL = feeLamports / 1e9; // Convert lamports to SOL
  const preBalances = meta?.preBalances || [];
  const postBalances = meta?.postBalances || [];
  const timeString = blockTime 
    ? new Date(blockTime * 1000).toLocaleString() 
    : "N/A";

  // Check instructions for known swap program IDs
  const instructions = transaction.message.instructions || [];
  let swapDetected = false;

  for (const ix of instructions) {
    // Each `ix` has a `programId` in the "parsed" transaction
    // but note that for "parsed" transactions, it might be
    // inside `ix.programId` or `ix.programId.toString()`
    const programIdStr = ix.programId?.toString() || "";
    if (KNOWN_SWAP_PROGRAM_IDS.includes(programIdStr)) {
      swapDetected = true;
      break;
    }
  }

  // Format balances for display
  const preBalancesFormatted = preBalances.map((b: number) => (b / 1e9).toFixed(8));
  const postBalancesFormatted = postBalances.map((b: number) => (b / 1e9).toFixed(8));

  const swapStatus = swapDetected ? "YES" : "NO";

  return [
    `Slot: ${slot}`,
    `Timestamp: ${timeString}`,
    `Fee: ${feeSOL.toFixed(8)} SOL`,
    `Pre-Transaction Balances: ${preBalancesFormatted.join(", ")}`,
    `Post-Transaction Balances: ${postBalancesFormatted.join(", ")}`,
    `Swap Detected: ${swapStatus}`,
  ];
}

// --------------------------------------------------------------
// Fetch token balances for a wallet
// --------------------------------------------------------------
async function fetchTokenBalances(walletAddress: string): Promise<string[]> {
  const publicKey = new PublicKey(walletAddress);

  const tokenAccounts = await connection.getTokenAccountsByOwner(publicKey, {
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  });

  const tokenBalances: string[] = [];
  for (const accountInfo of tokenAccounts.value) {
    const parsedData = await connection.getParsedAccountInfo(
      new PublicKey(accountInfo.pubkey)
    );
    const parsedInfo = (parsedData?.value?.data as ParsedAccountData)?.parsed?.info;
    if (parsedInfo) {
      const { mint, tokenAmount } = parsedInfo;
      tokenBalances.push(`Token: ${mint}, Balance: ${tokenAmount.uiAmountString}`);
    }
  }

  return tokenBalances;
}

// --------------------------------------------------------------
// Monitor WebSocket connection and handle disconnection
// --------------------------------------------------------------
async function monitorConnection() {
  try {
    // Simple check to ensure the node is responsive
    console.log("[Connection Monitor] Checking connection...");
    const version = await connection.getVersion(); 
    console.log(`[Connection Monitor] Connected. Solana version: ${version["solana-core"]}`);
  } catch (error) {
    console.error("[Connection Monitor] Connection lost. Attempting to reconnect...");
    connection = new Connection(SOLANA_RPC_URL, "confirmed");
    await startTrackingWallets(); // re-subscribe to account updates
  }
}

// --------------------------------------------------------------
// Subscribe to account updates via WebSocket
// --------------------------------------------------------------
async function subscribeToAccountUpdates(walletAddress: string) {
  const publicKey = new PublicKey(walletAddress);

  // onAccountChange triggers every time the account's lamports or data changes
  connection.onAccountChange(publicKey, async (accountInfo: AccountInfo<Buffer>) => {
    const lamports = accountInfo.lamports;
    const balance = lamports / 1e9; // Convert lamports to SOL

    let message = `🔔 **Dynamic Update** 🔔
Wallet: ${walletAddress}
SOL Balance: ${balance.toFixed(8)} SOL
`;

    // Fetch token balances
    try {
      const tokenBalances = await fetchTokenBalances(walletAddress);
      message += `\nToken Balances:\n${tokenBalances.join("\n")}`;
    } catch (error) {
      console.error(`[onAccountChange] Failed to fetch token balances for ${walletAddress}:`, error);
    }

    // Fetch recent transaction details
    try {
      const transactionDetails = await fetchRecentTransactions(walletAddress);
      message += `\nRecent Transaction Details:\n${transactionDetails.join("\n")}`;
    } catch (error) {
      console.error(`[onAccountChange] Failed to fetch recent transactions for ${walletAddress}:`, error);
    }

    // Log and send the update to Telegram
    console.log(message);
    await sendTelegramMessage(message);
  });
}

// --------------------------------------------------------------
// Start tracking wallets
// --------------------------------------------------------------
async function startTrackingWallets() {
  console.log("[Tracker] Attempting to subscribe to wallet updates...");

  for (const walletAddress of WALLET_ADDRESSES) {
    console.log(`[Tracker] Subscribing to updates for wallet: ${walletAddress}`);
    try {
      await subscribeToAccountUpdates(walletAddress);
    } catch (error) {
      console.error(`[Tracker] Error during subscription for ${walletAddress}:`, error);
    }
  }
}

// --------------------------------------------------------------
// Main function
// --------------------------------------------------------------
async function main() {
  try {
    console.log("Starting Solana Wallet Tracker...");
    await startTrackingWallets();
    console.log("Wallet tracking initialized.");

    // Monitor WebSocket connection periodically
    setInterval(monitorConnection, 30 * 1000); // Check connection every 30 seconds
  } catch (error) {
    console.error("[Main] Error in tracking:", error);
  }
}

// --------------------------------------------------------------
// Run the main entry point
// --------------------------------------------------------------
main();