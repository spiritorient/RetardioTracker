import { Connection, PublicKey, AccountInfo, ParsedAccountData } from "@solana/web3.js";
import * as dotenv from "dotenv";
import { Telegraf } from "telegraf";

// Load environment variables from .env
dotenv.config();

// Solana configuration
const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
let connection = new Connection(SOLANA_RPC_URL, "confirmed");

// Telegram Bot configuration
const BOT_TOKEN = "7927451768:AAEfIjHousM73AMxZ-5p0tEwdSiQ-RVidOQ";
const CHAT_ID = "7397808810";
if (!BOT_TOKEN || !CHAT_ID) {
  throw new Error("BOT_TOKEN or CHAT_ID is missing. Check your .env file.");
}
const bot = new Telegraf(BOT_TOKEN);

// Wallets to track
const WALLET_ADDRESSES = [
  "2UWHq9JNxnBi4ehpfivh9crJjG5EuayKCWsH9VuLXPeR",
  "AEHqTB2RtJjegsR2ePjvoJSm6AA5pnYKWVbcsn6kqTBD",
];

// Known Swap Program IDs
const SWAP_PROGRAM_IDS = {
  Orca: "9Ww2cPQwYBr0e8p2DGUK7LtGyDRq8d4ohMp4sd8qaCcF",
  Raydium: "4xqjzMwqDjoktf5Qj4cKN5VcRMZHXw6tucTD65xoCA5y",
};

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
      const { slot, meta, transaction: tx } = transaction;
      const fee = meta?.fee ? meta.fee / 1e9 : 0; // Convert lamports to SOL
      const blockTime = transaction.blockTime ? new Date(transaction.blockTime * 1000).toLocaleString() : "N/A";

      let swapDetails = "No swap detected.";

      // Detect and parse SWAP instructions
      for (const instr of tx.message.instructions) {
        const programId = instr.programId.toString();
        if (Object.values(SWAP_PROGRAM_IDS).includes(programId)) {
          swapDetails = parseSwapInstruction(instr, programId);
          break;
        }
      }

      return [
        `Slot: ${slot}`,
        `Timestamp: ${blockTime}`,
        `Fee: ${fee.toFixed(8)} SOL`,
        `Swap Details: ${swapDetails}`,
      ];
    } else {
      return ["Unable to fetch transaction details."];
    }
  } catch (error) {
    console.error(`Failed to fetch transactions for ${walletAddress}:`, error);
    return ["Error fetching transaction details."];
  }
}

// Parse swap instruction for details
function parseSwapInstruction(instruction: any, programId: string): string {
  try {
    const parsed = instruction.parsed || {};
    const source = parsed.info.source;
    const destination = parsed.info.destination;
    const amountIn = parsed.info.amountIn / 1e9; // Convert lamports to SOL
    const amountOut = parsed.info.amountOut / 1e9; // Convert lamports to SOL

    return `Swap detected on program: ${programId}\nSource: ${source}\nDestination: ${destination}\nAmount In: ${amountIn} SOL\nAmount Out: ${amountOut} SOL`;
  } catch (error) {
    console.error("Error parsing swap instruction:", error);
    return "Error parsing swap details.";
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
    await subscribeToAccountUpdates(walletAddress);
  }
}

// Main function
async function main() {
  console.log("Starting Solana Wallet Tracker...");
  await startTrackingWallets();
  console.log("Wallet tracking initialized.");
}

main().catch((error) => console.error("Error in tracking:", error));