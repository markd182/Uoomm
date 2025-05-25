const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");

// Hardcoded configuration
const RPC_URL = "https://testnet-rpc.monad.xyz";
const CONTRACT_ADDRESS = "0x0645565d6fdc37c9c7b7bd62cffb0126e8cffb61";

module.exports = async function (addLog, updatePanel, closeUI, requestInput, lang) {
  try {
    // Read private key from pvkey.txt in project root
    const privateKeyPath = path.join(__dirname, "..", "pvkey.txt");
    if (!fs.existsSync(privateKeyPath)) {
      throw new Error("pvkey.txt not found in project root");
    }
    const privateKey = fs.readFileSync(privateKeyPath, "utf8").trim();
    if (!privateKey) {
      throw new Error("Private key not found in pvkey.txt");
    }

    // Initialize provider and wallet
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(privateKey, provider);

    // Contract ABI
    const ABI = [
      "function openBox() public"
    ];

    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

    // Log start
    addLog(chalk.blue("Starting MonadBox openBox task..."));
    updatePanel(chalk.cyanBright("Initializing MonadBox contract interaction..."));

    // Prompt user for number of transactions
    const numTransactions = await requestInput(
      "Enter the number of openBox transactions to perform",
      "number",
      "1"
    );
    if (isNaN(numTransactions) || numTransactions <= 0) {
      const errorMessage = "Invalid number of transactions. Must be a positive number.";
      addLog(chalk.red(errorMessage));
      updatePanel(chalk.redBright(errorMessage));
      return;
    }

    // Log the number of transactions
    addLog(chalk.blue(`Preparing to send ${numTransactions} openBox transaction(s)...`));
    updatePanel(chalk.cyanBright(`Sending ${numTransactions} openBox transaction(s)...`));

    // Function to execute openBox
    async function openBox() {
      try {
        addLog(chalk.blue("Sending openBox transaction..."));
        const tx = await contract.openBox();
        addLog(chalk.green("Transaction sent: ") + chalk.yellow(tx.hash));
        updatePanel(chalk.cyanBright(`Transaction sent: ${tx.hash}`));

        const receipt = await tx.wait();
        addLog(chalk.green("Transaction confirmed: ") + chalk.yellow(receipt.transactionHash));
        updatePanel(chalk.cyanBright(`Transaction confirmed: ${receipt.transactionHash}`));
      } catch (error) {
        throw new Error(`Transaction failed: ${error.message}`);
      }
    }

    // Execute openBox the specified number of times
    for (let i = 1; i <= numTransactions; i++) {
      addLog(chalk.blue(`Transaction ${i} of ${numTransactions}`));
      updatePanel(chalk.cyanBright(`Processing transaction ${i} of ${numTransactions}...`));
      try {
        await openBox();
      } catch (error) {
        const errorMessage = `Error in transaction ${i}: ${error.message}`;
        addLog(chalk.red(errorMessage));
        updatePanel(chalk.redBright(errorMessage));
        // Continue to the next transaction despite the error
      }
    }

    // Log completion
    addLog(chalk.green("All transactions completed."));
    updatePanel(chalk.cyanBright("MonadBox task completed. Select another script..."));

  } catch (error) {
    const errorMessage = `Error in MonadBox task: ${error.message}`;
    addLog(chalk.red(errorMessage));
    updatePanel(chalk.redBright(errorMessage));
  }
};
