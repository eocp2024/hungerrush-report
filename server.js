require("dotenv").config();
const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const moment = require("moment");

const app = express();
const PORT = process.env.PORT || 8080;

// Utility: Delay function
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ** MAIN FUNCTION: Run Puppeteer to Get Report **
async function fetchReport(startDatetime, endDatetime) {
    console.log(`\n🕒 Received request for summary from ${startDatetime} to ${endDatetime}`);

    const browser = await puppeteer.launch({
        headless: "new", // Fully headless mode
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto("https://hub.hungerrush.com/", { waitUntil: "networkidle2" });

    // ** Login **
    console.log("🔑 Logging into HungerRush...");
    if (!process.env.HUNGER_RUSH_EMAIL || !process.env.HUNGER_RUSH_PASSWORD) {
        console.log("❌ ERROR: Missing environment variables (HUNGER_RUSH_EMAIL or HUNGER_RUSH_PASSWORD)");
        return { error: "Missing environment variables" };
    }

    await page.type("#UserName", process.env.HUNGER_RUSH_EMAIL);
    await page.type("#Password", process.env.HUNGER_RUSH_PASSWORD);
    await page.click("#newLogonButton");

    // ** Wait for page load **
    await page.waitForSelector("#rptvNextAnchor", { timeout: 30000 });

    console.log("✅ Login successful! Navigating to Order Details...");

    // ** Navigate to Reporting - NEW! **
    await page.evaluate(() => document.querySelector("#rptvNextAnchor").click());

    // ** Debug: Screenshot Before "Order Details" **
    console.log("📸 Taking a screenshot before looking for Order Details...");
    await page.screenshot({ path: "/app/debug-login.png", fullPage: true });

    // ** Wait for Order Details with better timeout & XPath **
    await page.waitForXPath("//span[contains(text(), 'Order Details')]", { timeout: 60000 });
    await page.waitForTimeout(2000); // Short delay before clicking
    const orderDetailsButton = await page.$x("//span[contains(text(), 'Order Details')]");
    await orderDetailsButton[0].click();
    console.log("✅ Clicked Order Details!");

    // ** Select Piqua Store **
    await page.waitForSelector(".p-multiselect-trigger-icon");
    await page.evaluate(() => document.querySelector(".p-multiselect-trigger-icon").click());
    await page.waitForXPath("//span[text()='Piqua']");
    const storeOption = await page.$x("//span[text()='Piqua']");
    await storeOption[0].click();
    console.log("✅ Selected Piqua store!");

    // ** Run Report **
    await page.waitForSelector("#runReport");
    await page.evaluate(() => document.querySelector("#runReport").click());
    console.log("📊 Running report...");

    // ** Export to Excel **
    await page.waitForXPath("//span[contains(text(), ' Export ')]", { timeout: 60000 });
    const exportDropdown = await page.$x("//span[contains(text(), ' Export ')]");
    await exportDropdown[0].click();

    await page.waitForXPath("//div[contains(text(), 'Export all data to Excel')]");
    const exportExcel = await page.$x("//div[contains(text(), 'Export all data to Excel')]");
    await exportExcel[0].click();
    console.log("📂 Report download initiated!");

    // ** Wait for file to download (simulate 10s delay) **
    await delay(10000);

    // ** Find Latest Excel File **
    const downloadDir = "/app/downloads"; // Set Railway's persistent storage directory
    const files = fs.readdirSync(downloadDir);
    const excelFile = files.filter((file) => file.includes("order-details") && file.endsWith(".xlsx")).sort()[0];

    if (!excelFile) {
        console.log("❌ ERROR: Excel file not found.");
        await browser.close();
        return { error: "Excel file not found." };
    }

    const excelPath = path.join(downloadDir, excelFile);
    console.log(`✅ Excel file found: ${excelPath}`);

    // ** Parse Excel File **
    const workbook = xlsx.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // ** Filter by Datetime **
    const filteredData = data.filter((row) => {
        const orderDatetime = moment(`${row.Date} ${row.Time}`, "MMM DD YYYY hh:mm A");
        return orderDatetime.isBetween(moment(startDatetime), moment(endDatetime), undefined, "[]");
    });

    // ** Compute Sales & Tips **
    const inStoreOrders = ["Pick Up", "Pickup", "To Go", "Web Pickup", "Web Pick Up"];
    const cashSalesInStore = filteredData.filter((order) => inStoreOrders.includes(order.Type) && order.Payment.includes("Cash")).reduce((sum, order) => sum + order.Total, 0);
    const cashSalesDelivery = filteredData.filter((order) => order.Type.includes("Delivery") && order.Payment.includes("Cash")).reduce((sum, order) => sum + order.Total, 0);
    const creditCardTipsInStore = filteredData.filter((order) => inStoreOrders.includes(order.Type) && /Visa|MC|AMEX/.test(order.Payment)).reduce((sum, order) => sum + (order.Tips || 0), 0);
    const creditCardTipsDelivery = filteredData.filter((order) => order.Type.includes("Delivery") && /Visa|MC|AMEX/.test(order.Payment)).reduce((sum, order) => sum + (order.Tips || 0), 0);

    await browser.close();
    console.log("✅ Report generation successful!");

    return {
        "Cash Sales (In-Store)": cashSalesInStore.toFixed(2),
        "Cash Sales (Delivery)": cashSalesDelivery.toFixed(2),
        "Credit Card Tips (In-Store)": creditCardTipsInStore.toFixed(2),
        "Credit Card Tips (Delivery)": creditCardTipsDelivery.toFixed(2),
    };
}

// ** API Route **
app.get("/", (req, res) => {
    res.send("<h2>✅ HungerRush Report API is running! Use <code>/summary</code> to fetch data.</h2>");
});

app.get("/summary", async (req, res) => {
    const { start_datetime, end_datetime } = req.query;
    if (!start_datetime || !end_datetime) return res.status(400).json({ error: "Missing parameters" });

    try {
        const result = await fetchReport(start_datetime, end_datetime);
        res.json(result);
    } catch (error) {
        console.error("❌ ERROR fetching report:", error);
        res.status(500).json({ error: "Failed to generate report." });
    }
});

// ** Start Server **
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
