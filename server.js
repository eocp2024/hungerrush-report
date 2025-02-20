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
    const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    // ** Set Download Directory to /tmp (Railway Safe) **
    const downloadPath = path.resolve("/tmp"); 
    await page._client().send("Page.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: downloadPath,
    });

    try {
        await page.goto("https://hub.hungerrush.com/", { waitUntil: "networkidle2" });

        // ** Login **
        await page.type("#UserName", process.env.HUNGER_RUSH_EMAIL);
        await page.type("#Password", process.env.HUNGER_RUSH_PASSWORD);
        await page.click("#newLogonButton");

        // ** Wait for navigation to Reporting - NEW! **
        await page.waitForSelector("#rptvNextAnchor", { timeout: 30000 });
        await page.evaluate(() => document.querySelector("#rptvNextAnchor").click());

        await page.waitForSelector("span:text('Order Details')", { timeout: 30000 });
        await page.evaluate(() => {
            document.evaluate("//span[text()='Order Details']", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.click();
        });

        // ** Select Piqua Store **
        await page.waitForSelector(".p-multiselect-trigger-icon");
        await page.evaluate(() => document.querySelector(".p-multiselect-trigger-icon").click());

        await page.waitForSelector("span:text('Piqua')");
        await page.evaluate(() => {
            document.evaluate("//span[text()='Piqua']", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.click();
        });

        // ** Run Report **
        await page.waitForSelector("#runReport");
        await page.evaluate(() => document.querySelector("#runReport").click());

        // ** Export to Excel **
        await page.waitForSelector("span:text(' Export ')", { timeout: 30000 });
        await page.evaluate(() => {
            document.evaluate("//span[text()=' Export ']", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.click();
        });

        await page.waitForSelector("div:text('Export all data to Excel')");
        await page.evaluate(() => {
            document.evaluate("//div[contains(text(), 'Export all data to Excel')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.click();
        });

        // ** Wait for file to download **
        await delay(15000);

        // ** Find Latest Excel File in /tmp **
        const files = fs.readdirSync(downloadPath);
        const excelFile = files.find(file => file.includes("order-details") && file.endsWith(".xlsx"));

        if (!excelFile) {
            throw new Error("Excel file not found.");
        }

        const excelPath = path.join(downloadPath, excelFile);

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

        return {
            "Cash Sales (In-Store)": cashSalesInStore.toFixed(2),
            "Cash Sales (Delivery)": cashSalesDelivery.toFixed(2),
            "Credit Card Tips (In-Store)": creditCardTipsInStore.toFixed(2),
            "Credit Card Tips (Delivery)": creditCardTipsDelivery.toFixed(2),
        };

    } catch (error) {
        console.error("Error fetching report:", error);
        await browser.close();
        return { error: error.message };
    }
}

// ** API Route **
app.get("/summary", async (req, res) => {
    const { start_datetime, end_datetime } = req.query;
    if (!start_datetime || !end_datetime) return res.status(400).json({ error: "Missing parameters" });

    console.log(`Received request for summary from ${start_datetime} to ${end_datetime}`);

    const result = await fetchReport(start_datetime, end_datetime);
    res.json(result);
});
// Default route to confirm API is running
app.get("/", (req, res) => {
    res.send("✅ HungerRush Report API is running! Use /summary to fetch data.");
});

// ** Start Server on PORT 8080 for Railway **
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
