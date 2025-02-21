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
    console.log(`📅 Received request for summary from ${startDatetime} to ${endDatetime}`);

    const browser = await puppeteer.launch({
        headless: true, // Fully headless mode
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto("https://hub.hungerrush.com/", { waitUntil: "networkidle2" });

    try {
        console.log("🔑 Logging into HungerRush...");

        // ** Login Process **
        await page.type("#UserName", process.env.HUNGER_RUSH_EMAIL);
        await page.type("#Password", process.env.HUNGER_RUSH_PASSWORD);
        await page.click("#newLogonButton");

        await page.waitForSelector("#rptvNextAnchor", { timeout: 30000 });
        console.log("✅ Login successful! Navigating to Order Details...");

        // ** Navigate to Reporting - NEW! **
        await page.click("#rptvNextAnchor");

        // ** Debug Screenshot Before Clicking Order Details **
        console.log("📸 Taking a screenshot before clicking Order Details...");
        await page.screenshot({ path: "/app/debug-before-click.png", fullPage: true });

        // ** Ensure 'Order Details' is Clickable **
        const orderDetailsXPath = "//span[text()='Order Details']";
        await page.waitForXPath(orderDetailsXPath, { timeout: 60000 });

        const orderDetailsButton = await page.$x(orderDetailsXPath);
        if (orderDetailsButton.length > 0) {
            console.log("🖱️ Scrolling to Order Details...");
            await page.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }), orderDetailsButton[0]);

            console.log("✅ Clicking Order Details!");
            await orderDetailsButton[0].click();
            await page.waitForTimeout(2000); // Short delay after clicking
        } else {
            throw new Error("❌ 'Order Details' button not found!");
        }

        console.log("✅ Selected Order Details!");

        // ** Select Piqua Store **
        await page.waitForSelector(".p-multiselect-trigger-icon");
        await page.click(".p-multiselect-trigger-icon");

        await page.waitForXPath("//span[text()='Piqua']", { timeout: 30000 });
        const piquaStoreButton = await page.$x("//span[text()='Piqua']");
        if (piquaStoreButton.length > 0) {
            await piquaStoreButton[0].click();
        } else {
            throw new Error("❌ 'Piqua' store option not found!");
        }

        console.log("✅ Selected Piqua Store!");

        // ** Click 'Run Report' **
        await page.waitForSelector("#runReport");
        await page.click("#runReport");

        console.log("📊 Running Report...");

        // ** Click 'Export' Dropdown **
        await page.waitForXPath("//div[@class='dx-button-content']//span[text()=' Export ']", { timeout: 30000 });
        const exportDropdown = await page.$x("//div[@class='dx-button-content']//span[text()=' Export ']");
        if (exportDropdown.length > 0) {
            await exportDropdown[0].click();
        } else {
            throw new Error("❌ 'Export' dropdown not found!");
        }

        console.log("✅ Opened Export dropdown!");

        // ** Select 'Export all data to Excel' **
        await page.waitForXPath("//div[contains(text(), 'Export all data to Excel')]", { timeout: 30000 });
        const exportExcelOption = await page.$x("//div[contains(text(), 'Export all data to Excel')]");
        if (exportExcelOption.length > 0) {
            await exportExcelOption[0].click();
        } else {
            throw new Error("❌ 'Export to Excel' option not found!");
        }

        console.log("📂 Report download initiated!");

        // ** Wait for file to download (simulate delay) **
        await delay(10000);

        // ** Locate Latest Excel File **
        const downloadDir = "/app/downloads"; // Ensure Railway's storage path
        const files = fs.readdirSync(downloadDir);
        const excelFile = files
            .filter((file) => file.includes("order-details") && file.endsWith(".xlsx"))
            .sort()
            .pop();

        if (!excelFile) {
            throw new Error("❌ Excel file not found!");
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
        const cashSalesInStore = filteredData
            .filter((order) => inStoreOrders.includes(order.Type) && order.Payment.includes("Cash"))
            .reduce((sum, order) => sum + order.Total, 0);
        const cashSalesDelivery = filteredData
            .filter((order) => order.Type.includes("Delivery") && order.Payment.includes("Cash"))
            .reduce((sum, order) => sum + order.Total, 0);
        const creditCardTipsInStore = filteredData
            .filter((order) => inStoreOrders.includes(order.Type) && /Visa|MC|AMEX/.test(order.Payment))
            .reduce((sum, order) => sum + (order.Tips || 0), 0);
        const creditCardTipsDelivery = filteredData
            .filter((order) => order.Type.includes("Delivery") && /Visa|MC|AMEX/.test(order.Payment))
            .reduce((sum, order) => sum + (order.Tips || 0), 0);

        await browser.close();

        return {
            "Cash Sales (In-Store)": cashSalesInStore.toFixed(2),
            "Cash Sales (Delivery)": cashSalesDelivery.toFixed(2),
            "Credit Card Tips (In-Store)": creditCardTipsInStore.toFixed(2),
            "Credit Card Tips (Delivery)": creditCardTipsDelivery.toFixed(2),
        };
    } catch (error) {
        console.error(`❌ ERROR during Puppeteer execution: ${error}`);
        await browser.close();
        return { error: error.message };
    }
}

// ** API Route **
app.get("/summary", async (req, res) => {
    const { start_datetime, end_datetime } = req.query;
    if (!start_datetime || !end_datetime) {
        return res.status(400).json({ error: "❌ Missing parameters" });
    }

    const result = await fetchReport(start_datetime, end_datetime);
    res.json(result);
});

// ** Default Route **
app.get("/", (req, res) => {
    res.send("✅ HungerRush Report API is running! Use /summary to fetch data.");
});

// ** Start Server **
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));