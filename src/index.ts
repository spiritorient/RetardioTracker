import {
  Connection,
  PublicKey,
  AccountInfo,
  ParsedAccountData,
  ParsedTransactionWithMeta
} from "@solana/web3.js";
import { Telegraf } from "telegraf";

// -----------------------------------------------------------------------------
// 1. Solana Configuration
// -----------------------------------------------------------------------------
const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
let connection = new Connection(SOLANA_RPC_URL, "confirmed");

// -----------------------------------------------------------------------------
// 2. Telegram Bot Configuration
// -----------------------------------------------------------------------------
const BOT_TOKEN = "7927451768:AAEfIjHousM73AMxZ-5p0tEwdSiQ-RVidOQ";
const CHAT_IDS = ["7739753477"];

if (!BOT_TOKEN || CHAT_IDS.length === 0) {
  throw new Error("BOT_TOKEN or CHAT_IDS are missing.");
}
const bot = new Telegraf(BOT_TOKEN);

// -----------------------------------------------------------------------------
// 3. Wallets to Track
// -----------------------------------------------------------------------------
const WALLET_ADDRESSES = [
  "2UWHq9JNxnBi4ehpfivh9crJjG5EuayKCWsH9VuLXPeR",
  "HxjcMB4kfrwmGLZRk3dzwbd6EJJLDTceZgVv6Dw2WoaY",
  "vTR35h5eW75D54ckufYgvtrmCT5dwBYFFcPrfb8kyVm",
  "DSt7xDwaibMXDAnym7j5WdThwqcm1mQPA3JoKriH6Bqi",
  "9YeiNE6Doq6VaHAEgfUkRvzcstyRhEAyaMGgiT5Vq3qB",
  "Ffyr33dWsurJpQyWUcbz9c3JWRRw6NBmqAUwHF4sQwzo",
  "8FthQ5hgRCGUnqmKxndk5nmwsAqm1HGHPDMBopsBNVpA",
  "Fc5rnJJDk8a8kN3MnoSJZy4Fn3B9QAD79XQCsWckZRYu",
  "Gk17RVYvVi7kWzQXayUDKpvLwPbQYG7YBnUJaGLvRqrb",
  "DSt7xDwaibMXDAnym7j5WdThwqcm1mQPA3JoKriH6Bqi",
  "9mKN5zoWJLDNNqGRnRKDmgJ8gDNFuZv3JKcTsnEN3uJJ",
  "5zReCULLatoDq4XtU24jvFvUqseSyRcFpVhh3YF1io91",
  "FDFErfrXujhXraizjEVB8mgWQHwyC1dSkEKH8GB7HMbp",
  "CL3fhHsrB2WhntaX7ME3wBPgLNfxsG1iFhmgc4szjP2d",
  "AwAorTYrqDzKhpeRZx4LdMuRsaHQJu6kcAR7rC47DqsT",
  "HtXdfW9U4jp8524cyw2jAQfMPiff5WYdSLnozF3sEbYi",
  "4PseMpW7s7HnfkAd6DzJqwtPtNxXBGokzWHDgJc1i3k8",
  "ALFWv3NjES1AvjaYKAp9BzpyiWVYpJWnNWsA3xiExwvk",
  "EZqKNT6bgg4zET43fkusnVMcVEBrx8CqxJupsVheTiN3",
  "H91Y4q87bbctbH9SNiHrATQo2W4nvagbyPXMhFnFtDvQ",
  "5RZivXzyW9LMsX9Uw9Gh6sZzSkkzGt9xzy3EjTVmVCvM",
  "cvP9pZDXYHF9gdzc7wQsiEkAjVpAF9CJD51j8AfqZur",
  "9rnja4tnmcAkFbTPfw9TfCdxa4DHwNFSYbtYhGWGbsu8",
  "CXHP5cLsp1foLMJwt7oQWVKHKNKx1YYr9VdKBLguyAvB",
  "2oNKbow4aHX5rbNsPUA69QE2yjuxV86vJ9MLYsTZbS1U",
  "7eYhqVKWuXQ8mdqYQe12Trhei6X8vHPvfiPeS398k6am"
];

// -----------------------------------------------------------------------------
// 4. Known Swap Program IDs
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// 5. Cooldown Management
// -----------------------------------------------------------------------------
const FETCH_COOLDOWN_MS = 15000; // 15 seconds
const lastFetchTime: Record<string, number> = {};

// -----------------------------------------------------------------------------
// 6. Telegram Messaging Helper
// -----------------------------------------------------------------------------
async function sendTelegramMessage(message: string) {
  try {
    for (const chatId of CHAT_IDS) {
      await bot.telegram.sendMessage(chatId, message);
      console.log(`[Telegram] Message sent to chat ID: ${chatId}`);
    }
  } catch (error) {
    console.error("[Telegram] Failed to send message:", error);
  }
}

// -----------------------------------------------------------------------------
// 7. Fetch Recent Transactions
// -----------------------------------------------------------------------------
async function fetchRecentTransactions(walletAddress: string): Promise<string[]> {
  try {
    const publicKey = new PublicKey(walletAddress);
    const signatures = await connection.getSignaturesForAddress(publicKey, { limit: 1 });

    if (signatures.length === 0) {
      return ["No recent transactions found."];
    }

    const recentSignature = signatures[0].signature;
    const parsedTx = await connection.getParsedTransaction(recentSignature, {
      commitment: "confirmed"
    });

    if (!parsedTx) return ["Unable to fetch transaction details."];

    const { slot, blockTime, meta } = parsedTx;
    const fee = (meta?.fee ?? 0) / 1e9;
    const timeString = blockTime ? new Date(blockTime * 1000).toLocaleString() : "N/A";

    let swapDetected = false;
    parsedTx.transaction.message.instructions.forEach((ix) => {
      if (KNOWN_SWAP_PROGRAM_IDS.includes(ix.programId.toString())) {
        swapDetected = true;
      }
    });

    return [
      `Slot: ${slot}`,
      `Timestamp: ${timeString}`,
      `Fee: ${fee.toFixed(8)} SOL`,
      `Swap Detected: ${swapDetected ? "YES" : "NO"}`,
    ];
  } catch (error) {
    console.error(`Failed to fetch transactions for ${walletAddress}:`, error);
    return ["Error fetching transaction details."];
  }
}

// -----------------------------------------------------------------------------
// 8. Fetch Token Balances
// -----------------------------------------------------------------------------
async function fetchTokenBalances(walletAddress: string): Promise<string[]> {
  try {
    const publicKey = new PublicKey(walletAddress);

    // Fetch token accounts owned by the wallet
    const tokenAccounts = await connection.getTokenAccountsByOwner(publicKey, {
      programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    });

    const balances: string[] = [];

    for (const { pubkey, account } of tokenAccounts.value) {
      // Cast account.data to unknown first, then safely check if it matches ParsedAccountData
      const data = account.data as unknown;
      if (data && typeof data === "object" && "parsed" in data) {
        const parsedData = data as ParsedAccountData;
        const parsedInfo = parsedData.parsed?.info;

        const mint = parsedInfo?.mint || "Unknown";
        const balance = parsedInfo?.tokenAmount?.uiAmountString || "0";

        balances.push(`Token: ${mint}, Balance: ${balance}`);
      } else {
        console.warn(`Unparsed or invalid account data for pubkey: ${pubkey.toString()}`);
      }
    }

    return balances;
  } catch (error) {
    console.error(`Failed to fetch token balances for ${walletAddress}:`, error);
    return ["Error fetching token balances."];
  }
}

// -----------------------------------------------------------------------------
// 9. Subscribe to Account Updates
// -----------------------------------------------------------------------------
async function subscribeToAccountUpdates(walletAddress: string) {
  const publicKey = new PublicKey(walletAddress);

  connection.onAccountChange(publicKey, async (accountInfo: AccountInfo<Buffer>) => {
    const now = Date.now();
    if (lastFetchTime[walletAddress] && now - lastFetchTime[walletAddress] < FETCH_COOLDOWN_MS) {
      return; // Skip if within cooldown
    }

    lastFetchTime[walletAddress] = now;

    const lamports = accountInfo.lamports;
    const balanceSOL = lamports / 1e9;

    let message = `🔔 **Dynamic Update** 🔔\nWallet: ${walletAddress}\nSOL Balance: ${balanceSOL.toFixed(8)} SOL\n`;

    try {
      const tokenBalances = await fetchTokenBalances(walletAddress);
      message += `\nToken Balances:\n${tokenBalances.join("\n")}`;
    } catch (error) {
      console.error(`Failed to fetch token balances for ${walletAddress}:`, error);
    }

    try {
      const recentTransactions = await fetchRecentTransactions(walletAddress);
      message += `\nRecent Transactions:\n${recentTransactions.join("\n")}`;
    } catch (error) {
      console.error(`Failed to fetch recent transactions for ${walletAddress}:`, error);
    }

    console.log(message);
    await sendTelegramMessage(message);
  });
}

// -----------------------------------------------------------------------------
// 10. Start Tracking Wallets
// -----------------------------------------------------------------------------
async function startTrackingWallets() {
  console.log("[Tracker] Subscribing to wallet updates...");

  for (const walletAddress of WALLET_ADDRESSES) {
    try {
      await subscribeToAccountUpdates(walletAddress);
      console.log(`[Tracker] Subscribed to wallet: ${walletAddress}`);
    } catch (error) {
      console.error(`[Tracker] Failed to subscribe for wallet: ${walletAddress}`, error);
    }
  }
}

// -----------------------------------------------------------------------------
// 11. Main Entry Point
// -----------------------------------------------------------------------------
async function main() {
  try {
    console.log("Starting Solana Wallet Tracker...");
    await startTrackingWallets();

    // Monitor connection every 60 seconds
    setInterval(async () => {
      try {
        const version = await connection.getVersion();
        console.log(`[Connection Monitor] Connected. Solana version: ${version["solana-core"]}`);
      } catch (error) {
        console.error("[Connection Monitor] Connection lost. Reconnecting...");
        connection = new Connection(SOLANA_RPC_URL, "confirmed");
        await startTrackingWallets();
      }
    }, 60000);

    console.log("Wallet tracking initialized.");
  } catch (error) {
    console.error("Error initializing wallet tracker:", error);
  }
}

main();