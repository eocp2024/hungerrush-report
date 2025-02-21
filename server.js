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
    console.log(`Received request for summary from ${startDatetime} to ${endDatetime}`);

    // Validate environment variables
    if (!process.env.HUNGER_RUSH_EMAIL || !process.env.HUNGER_RUSH_PASSWORD) {
        console.error("❌ ERROR: Missing environment variables (HUNGER_RUSH_EMAIL or HUNGER_RUSH_PASSWORD)");
        return { error: "Server misconfiguration: Missing credentials." };
    }

    // Launch Puppeteer
    const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
        const page = await browser.newPage();
        await page.goto("https://hub.hungerrush.com/", { waitUntil: "networkidle2" });

        console.log("🔑 Logging into HungerRush...");

        // Login (Ensure Email & Password are defined)
        await page.type("#UserName", String(process.env.HUNGER_RUSH_EMAIL));
        await page.type("#Password", String(process.env.HUNGER_RUSH_PASSWORD));
        await page.click("#newLogonButton");

        // Wait for Dashboard to Load
        await page.waitForSelector("#rptvNextAnchor", { timeout: 30000 });

        console.log("✅ Login successful! Navigating to Order Details...");

        // Navigate to Reporting - NEW!
        await page.evaluate(() => document.querySelector("#rptvNextAnchor").click());
        await page.waitForSelector("span:text('Order Details')", { timeout: 30000 });
        await page.evaluate(() => {
            document.evaluate(
                "//span[text()='Order Details']",
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue.click();
        });

        // Select Piqua Store
        await page.waitForSelector(".p-multiselect-trigger-icon");
        await page.evaluate(() => document.querySelector(".p-multiselect-trigger-icon").click());
        await page.waitForSelector("span:text('Piqua')");
        await page.evaluate(() => {
            document.evaluate(
                "//span[text()='Piqua']",
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue.click();
        });

        // Run Report
        await page.waitForSelector("#runReport");
        await page.evaluate(() => document.querySelector("#runReport").click());

        console.log("📊 Running report...");

        // Export to Excel
        await page.waitForSelector("span:text(' Export ')", { timeout: 30000 });
        await page.evaluate(() => {
            document.evaluate(
                "//span[text()=' Export ']",
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue.click();
        });

        await page.waitForSelector("div:text('Export all data to Excel')");
        await page.evaluate(() => {
            document.evaluate(
                "//div[contains(text(), 'Export all data to Excel')]",
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue.click();
        });

        console.log("📥 Exporting report to Excel...");

        // ** Wait for file to download (simulate 10s delay) **
        await delay(10000);

        // ** Find Latest Excel File **
        const downloadDir = "/app/downloads"; // Set Railway's persistent storage directory
        const files = fs.readdirSync(downloadDir);
        const excelFile = files.filter((file) => file.includes("order-details") && file.endsWith(".xlsx")).sort()[0];

        if (!excelFile) {
            await browser.close();
            console.error("❌ ERROR: Excel file not found.");
            return { error: "Report download failed." };
        }

        const excelPath = path.join(downloadDir, excelFile);
        console.log(`✅ Excel file found: ${excelPath}`);

        // ** Parse Excel File **
        const workbook = xlsx.readFile(excelPath);
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        console.log(`📊 Parsing Excel Sheet: ${sheetName}`);

        // ** Filter by Datetime **
        const filteredData = data.filter((row) => {
            const orderDatetime = moment(`${row.Date} ${row.Time}`, "MMM DD YYYY hh:mm A");
            return orderDatetime.isBetween(moment(startDatetime), moment(endDatetime), undefined, "[]");
        });

        console.log(`📊 Orders found in range: ${filteredData.length}`);

        // ** Compute Sales & Tips **
        const inStoreOrders = ["Pick Up", "Pickup", "To Go", "Web Pickup", "Web Pick Up"];
        const cashSalesInStore = filteredData.filter((order) => inStoreOrders.includes(order.Type) && order.Payment.includes("Cash")).reduce((sum, order) => sum + order.Total, 0);
        const cashSalesDelivery = filteredData.filter((order) => order.Type.includes("Delivery") && order.Payment.includes("Cash")).reduce((sum, order) => sum + order.Total, 0);
        const creditCardTipsInStore = filteredData.filter((order) => inStoreOrders.includes(order.Type) && /Visa|MC|AMEX/.test(order.Payment)).reduce((sum, order) => sum + (order.Tips || 0), 0);
        const creditCardTipsDelivery = filteredData.filter((order) => order.Type.includes("Delivery") && /Visa|MC|AMEX/.test(order.Payment)).reduce((sum, order) => sum + (order.Tips || 0), 0);

        console.log("✅ Report successfully processed!");

        await browser.close();

        return {
            "Cash Sales (In-Store)": cashSalesInStore.toFixed(2),
            "Cash Sales (Delivery)": cashSalesDelivery.toFixed(2),
            "Credit Card Tips (In-Store)": creditCardTipsInStore.toFixed(2),
            "Credit Card Tips (Delivery)": creditCardTipsDelivery.toFixed(2),
        };

    } catch (error) {
        console.error("❌ ERROR during Puppeteer execution:", error);
        await browser.close();
        return { error: "Internal processing error. Please try again." };
    }
}

// ** API Route **
app.get("/", (req, res) => {
    res.send("✅ HungerRush Report API is running! Use /summary to fetch data.");
});

app.get("/summary", async (req, res) => {
    const { start_datetime, end_datetime } = req.query;
    if (!start_datetime || !end_datetime) {
        return res.status(400).json({ error: "Missing parameters" });
    }

    const result = await fetchReport(start_datetime, end_datetime);
    res.json(result);
});

// ** Start Server **
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
