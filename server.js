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

async function fetchReport(startDatetime, endDatetime) {
    console.log(`📅 Fetching report from ${startDatetime} to ${endDatetime}`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox"
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser"
    });

    const page = await browser.newPage();
    
    try {
        // Step 1: Login
        console.log("🔑 Logging in...");
        await page.goto("https://hub.hungerrush.com/", { waitUntil: "networkidle2" });
        await page.type("#UserName", process.env.HUNGER_RUSH_EMAIL);
        await page.type("#Password", process.env.HUNGER_RUSH_PASSWORD);
        await page.click("#newLogonButton");

        // Step 2: Wait for main interface
        await page.waitForSelector(".main-nav-container", { timeout: 30000 });
        console.log("✅ Login successful!");
        await page.screenshot({ path: "debug-after-login.png" });

        // Step 3: Navigate via Left Menu
        console.log("🧭 Navigating to Order Details...");
        const leftMenuXPath = "//div[@class='main-nav-container']//span[text()='Order Details']/ancestor::a";
        
        let menuFound = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const [orderDetailsLink] = await page.$x(leftMenuXPath);
                if (orderDetailsLink) {
                    console.log(`Attempt ${attempt}: Found Order Details menu`);
                    await orderDetailsLink.click();
                    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 });
                    menuFound = true;
                    break;
                }
            } catch (error) {
                console.log(`Attempt ${attempt} failed, retrying...`);
                await delay(2000);
            }
        }

        if (!menuFound) {
            throw new Error("❌ Failed to find Order Details in left menu after 3 attempts");
        }

        // Step 4: Verify Report Page Loaded
        await page.waitForSelector(".report-parameters-container", { timeout: 30000 });
        console.log("✅ Successfully reached Order Details page");
        await page.screenshot({ path: "debug-order-details-page.png" });

        // Step 5: Configure Report Parameters
        console.log("⚙️ Configuring report...");
        
        await page.click("#startDate input");
        await page.keyboard.type(moment(startDatetime).format("MM/DD/YYYY"));
        await page.click("#endDate input");
        await page.keyboard.type(moment(endDatetime).format("MM/DD/YYYY"));

        // Select Piqua store
        await page.click(".p-multiselect-trigger");
        await page.waitForSelector(".p-multiselect-items");
        const piquaCheckbox = await page.$x("//li[@aria-label='Piqua']//div[contains(@class, 'checkbox')]");
        await piquaCheckbox[0].click();
        await page.keyboard.press("Escape");

        // Step 6: Generate and Download Report
        console.log("📊 Generating report...");
        const runReportButton = await page.$("#runReport");
        await runReportButton.click();
        
        // Wait for data grid to load
        await page.waitForSelector(".dx-datagrid-rowsview", { timeout: 60000 });

        // Initiate export
        console.log("📥 Downloading Excel...");
        const exportButton = await page.$x("//span[text()=' Export ']/ancestor::div[contains(@class, 'dx-button')]");
        await exportButton[0].click();
        await page.click(".dx-menu-item-text:has-text('Export all data to Excel')");

        // Wait for download
        await delay(10000);

        // Step 7: Process Excel File
        const downloadDir = path.join(__dirname, "downloads");
        const files = fs.readdirSync(downloadDir)
            .filter(f => f.startsWith("order-details") && f.endsWith(".xlsx"))
            .sort((a, b) => fs.statSync(path.join(downloadDir, b)).mtimeMs - fs.statSync(path.join(downloadDir, a)).mtimeMs);
        
        if (files.length === 0) throw new Error("❌ No Excel file found");
        const workbook = xlsx.readFile(path.join(downloadDir, files[0]));
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        // Step 8: Filter and Calculate
        const filteredData = data.filter(row => {
            const orderDate = moment(`${row.Date} ${row.Time}`, "MMM DD YYYY hh:mm A");
            return orderDate.isBetween(moment(startDatetime), moment(endDatetime), null, "[]");
        });

        const result = {
            totalOrders: filteredData.length,
            totalSales: filteredData.reduce((sum, row) => sum + row.Total, 0).toFixed(2),
            cashSales: filteredData.filter(row => row.Payment?.includes("Cash"))
                              .reduce((sum, row) => sum + row.Total, 0).toFixed(2),
            creditCardTips: filteredData.filter(row => !row.Payment?.includes("Cash"))
                                  .reduce((sum, row) => sum + (row.Tips || 0), 0).toFixed(2)
        };

        console.log("✅ Report processing complete");
        return result;

    } catch (error) {
        console.error("❌ Error:", error);
        await page.screenshot({ path: "error-screenshot.png" });
        throw error;
    } finally {
        await browser.close();
    }
}

app.get("/report", async (req, res) => {
    try {
        const { start, end } = req.query;
        if (!start || !end) return res.status(400).json({ error: "Missing date parameters" });
        
        const report = await fetchReport(start, end);
        res.json({
            status: "success",
            dateRange: `${start} - ${end}`,
            ...report
        });
    } catch (error) {
        res.status(500).json({
            status: "error",
            message: error.message,
            details: error.stack
        });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
