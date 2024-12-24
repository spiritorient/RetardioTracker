import {
  Connection,
  PublicKey,
  AccountInfo,
  ParsedAccountData,
  ParsedTransactionWithMeta
} from "@solana/web3.js";
import { Telegraf } from "telegraf";

// -----------------------------------------------------------------------------
// 1. Solana Config: Consider using a paid endpoint if you have 25+ wallets
// -----------------------------------------------------------------------------
const SOLANA_WS_URL = "wss://api.mainnet-beta.solana.com";
// Example: const SOLANA_WS_URL = "wss://your_private_endpoint_here";
const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
// Example: const SOLANA_RPC_URL = "https://your_private_endpoint_here";

// Create a new connection
let connection = new Connection(SOLANA_RPC_URL, "confirmed");

// -----------------------------------------------------------------------------
// 2. Telegram Bot Config
// -----------------------------------------------------------------------------
const BOT_TOKEN = "7927451768:AAEfIjHousM73AMxZ-5p0tEwdSiQ-RVidOQ";
const CHAT_IDS = ["7739753477"]; // e.g. ["123456789"] or multiple IDs if needed

if (!BOT_TOKEN || CHAT_IDS.length === 0) {
  throw new Error("BOT_TOKEN or CHAT_IDS are missing.");
}

const bot = new Telegraf(BOT_TOKEN);

// -----------------------------------------------------------------------------
// 3. Wallet Addresses to Track
// -----------------------------------------------------------------------------
const WALLET_ADDRESSES = [
  "2UWHq9JNxnBi4ehpfivh9crJjG5EuayKCWsH9VuLXPeR",
  "HxjcMB4kfrwmGLZRk3dzwbd6EJJLDTceZgVv6Dw2WoaY",
  "H91Y4q87bbctbH9SNiHrATQo2W4nvagbyPXMhFnFtDvQ",
  "5RZivXzyW9LMsX9Uw9Gh6sZzSkkzGt9xzy3EjTVmVCvM",
  "cvP9pZDXYHF9gdzc7wQsiEkAjVpAF9CJD51j8AfqZur",
  "9rnja4tnmcAkFbTPfw9TfCdxa4DHwNFSYbtYhGWGbsu8",
  "CXHP5cLsp1foLMJwt7oQWVKHKNKx1YYr9VdKBLguyAvB",
  "2oNKbow4aHX5rbNsPUA69QE2yjuxV86vJ9MLYsTZbS1U",
  "7eYhqVKWuXQ8mdqYQe12Trhei6X8vHPvfiPeS398k6am",
  "Fc5rnJJDk8a8kN3MnoSJZy4Fn3B9QAD79XQCsWckZRYu",
  "Gk17RVYvVi7kWzQXayUDKpvLwPbQYG7YBnUJaGLvRqrb",
  "DSt7xDwaibMXDAnym7j5WdThwqcm1mQPA3JoKriH6Bqi",
  "9mKN5zoWJLDNNqGRnRKDmgJ8gDNFuZv3JKcTsnEN3uJJ"
];

// -----------------------------------------------------------------------------
// 4. Known Swap Program IDs (for swap detection)
// -----------------------------------------------------------------------------
const KNOWN_SWAP_PROGRAM_IDS = [
  "RVKd61ztZW9VYGrgzeXkqUyXTN4C2xz7RtXnYmAB3Jo",
  "9xQeWvG816bUx9EPv6gSuE7iEEh7ouE9Z2w2n7aM6bZX",
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",
  "9W5kdiR2b1aGZTVysb3tYZkzDU5QbBhAsCRc5Qugosxh",
];

// -----------------------------------------------------------------------------
// 5. Rate-Limiting / Cooldown
// -----------------------------------------------------------------------------

// We store the last time we fetched each wallet. We'll also queue up changes
// that happen during the cooldown, so we only fetch once every COOL_DOWN_MS.
const FETCH_COOLDOWN_MS = 15000; // 15 seconds to be extra cautious
const lastFetchTime: Record<string, number> = {};

// Optional queue: store “pending changes” for each wallet
const pendingChanges: Record<string, boolean> = {};

// -----------------------------------------------------------------------------
// 6. Telegram Messaging Helper
// -----------------------------------------------------------------------------
async function sendTelegramMessage(message: string) {
  try {
    for (const chatId of CHAT_IDS) {
      await bot.telegram.sendMessage(chatId, message);
      console.log(`[Telegram] Message sent successfully to chat ID: ${chatId}`);
    }
  } catch (error) {
    console.error("[Telegram] Failed to send message:", error);
  }
}

// -----------------------------------------------------------------------------
// 7. Fetch Single Most Recent Transaction, Detect Swap
// -----------------------------------------------------------------------------
async function fetchRecentTransactions(walletAddress: string): Promise<string[]> {
  const publicKey = new PublicKey(walletAddress);
  try {
    const signatures = await connection.getSignaturesForAddress(publicKey, { limit: 1 });
    if (signatures.length === 0) {
      return ["No recent transactions found."];
    }
    const recentSignature = signatures[0].signature;

    // maxSupportedTransactionVersion: 0 to avoid version mismatch
    const transaction = await connection.getParsedTransaction(recentSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
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

// -----------------------------------------------------------------------------
// 8. Format Transaction Details & Detect Swaps
// -----------------------------------------------------------------------------
function formatTransactionDetails(tx: ParsedTransactionWithMeta): string[] {
  const { slot, transaction, meta, blockTime } = tx;
  const feeLamports = meta?.fee ?? 0;
  const feeSOL = feeLamports / 1e9;
  const preBalances = meta?.preBalances || [];
  const postBalances = meta?.postBalances || [];
  const timeString = blockTime ? new Date(blockTime * 1000).toLocaleString() : "N/A";

  const instructions = transaction.message.instructions || [];
  let swapDetected = false;
  for (const ix of instructions) {
    if (KNOWN_SWAP_PROGRAM_IDS.includes(ix.programId?.toString() || "")) {
      swapDetected = true;
      break;
    }
  }

  const preBalancesFormatted = preBalances.map((b) => (b / 1e9).toFixed(8));
  const postBalancesFormatted = postBalances.map((b) => (b / 1e9).toFixed(8));
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

// -----------------------------------------------------------------------------
// 9. Fetch Token Balances
// -----------------------------------------------------------------------------
async function fetchTokenBalances(walletAddress: string): Promise<string[]> {
  const publicKey = new PublicKey(walletAddress);
  const tokenAccounts = await connection.getTokenAccountsByOwner(publicKey, {
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  });

  const balances: string[] = [];
  for (const accountInfo of tokenAccounts.value) {
    const parsedData = await connection.getParsedAccountInfo(new PublicKey(accountInfo.pubkey));
    const parsedInfo = (parsedData?.value?.data as ParsedAccountData)?.parsed?.info;
    if (parsedInfo) {
      const { mint, tokenAmount } = parsedInfo;
      balances.push(`Token: ${mint}, Balance: ${tokenAmount.uiAmountString}`);
    }
  }
  return balances;
}

// -----------------------------------------------------------------------------
// 10. Connection Monitor for WebSocket
// -----------------------------------------------------------------------------
async function monitorConnection() {
  try {
    console.log("[Connection Monitor] Checking connection...");
    const version = await connection.getVersion();
    console.log(`[Connection Monitor] Connected. Solana version: ${version["solana-core"]}`);
  } catch (error) {
    console.error("[Connection Monitor] Connection lost. Attempting to reconnect...");
    connection = new Connection(SOLANA_RPC_URL, "confirmed");
    await startTrackingWallets(); // re-subscribe
  }
}

// -----------------------------------------------------------------------------
// 11. Subscribe to Account Updates
// -----------------------------------------------------------------------------
async function subscribeToAccountUpdates(walletAddress: string) {
  const publicKey = new PublicKey(walletAddress);

  connection.onAccountChange(publicKey, async (accountInfo: AccountInfo<Buffer>) => {
    // Mark that this wallet had a change
    pendingChanges[walletAddress] = true;

    // We’ll do a small “delay” approach: if we’re within cooldown, skip immediate fetch
    const now = Date.now();
    const lastTime = lastFetchTime[walletAddress] || 0;
    const sinceLast = now - lastTime;

    if (sinceLast < FETCH_COOLDOWN_MS) {
      // Wait until cooldown is over
      return;
    }

    // If the cooldown is passed, do the fetch
    await doFetchAndSendMessage(walletAddress, accountInfo.lamports);
  });
}

/**
 * Actually fetch data and send Telegram message.
 */
async function doFetchAndSendMessage(walletAddress: string, lamports: number) {
  // Reset the last fetch time
  lastFetchTime[walletAddress] = Date.now();
  pendingChanges[walletAddress] = false; // we’re about to process it

  const balanceSOL = lamports / 1e9;
  let message = `🔔 **Dynamic Update** 🔔
Wallet: ${walletAddress}
SOL Balance: ${balanceSOL.toFixed(8)} SOL
`;

  // Fetch token balances
  try {
    const tokenBalances = await fetchTokenBalances(walletAddress);
    message += `\nToken Balances:\n${tokenBalances.join("\n")}`;
  } catch (error) {
    console.error(`[onAccountChange] Failed to fetch token balances for ${walletAddress}:`, error);
  }

  // Fetch recent transactions
  try {
    const transactionDetails = await fetchRecentTransactions(walletAddress);
    message += `\nRecent Transaction Details:\n${transactionDetails.join("\n")}`;
  } catch (error) {
    console.error(`[onAccountChange] Failed to fetch recent transactions for ${walletAddress}:`, error);
  }

  console.log(message);
  await sendTelegramMessage(message);
}

// -----------------------------------------------------------------------------
// 12. Start Tracking Wallets
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// 13. Main Entry Point
// -----------------------------------------------------------------------------
async function main() {
  try {
    console.log("Starting Solana Wallet Tracker...");
    await startTrackingWallets();
    console.log("Wallet tracking initialized.");

    // Check connection every 60 seconds
    setInterval(monitorConnection, 60_000);
  } catch (error) {
    console.error("[Main] Error in tracking:", error);
  }
}

main();