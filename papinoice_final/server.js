const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;

const ROOT = path.join(__dirname, "public");
const DBFILE = path.join(__dirname, "data", "db.json");


// =====================================================
// DATABASE
// =====================================================

let db = JSON.parse(
    fs.readFileSync(DBFILE, "utf8")
);

function save() {
    fs.writeFileSync(
        DBFILE,
        JSON.stringify(db, null, 2)
    );
}


// =====================================================
// SESSIONS
// =====================================================

const sessions = new Map();


// =====================================================
// HELPERS
// =====================================================

function json(res, status, data) {

    res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
    });

    res.end(
        JSON.stringify(data)
    );
}


function body(req) {

    return new Promise((resolve, reject) => {

        let data = "";

        req.on("data", chunk => {
            data += chunk;
        });

        req.on("end", () => {

            try {

                resolve(
                    data
                        ? JSON.parse(data)
                        : {}
                );

            } catch (error) {

                reject(error);

            }

        });

        req.on("error", reject);

    });

}


function getUser(req) {

    const token =
        (req.headers.authorization || "")
            .replace("Bearer ", "");

    return sessions.get(token);

}


function status(product) {

    if (product.stock <= 0) {
        return "OUT";
    }

    if (product.stock <= product.minStock) {
        return "LOW";
    }

    return "IN";
}


function publicProduct(product) {

    return {
        ...product,

        status: status(product),

        boxes: Math.floor(
            product.stock / 24
        ),

        rem: product.stock % 24
    };

}


function billNo() {

    return (
        "PAP-" +
        new Date()
            .toISOString()
            .slice(0, 10)
            .replaceAll("-", "") +
        "-" +
        String(db.sales.length + 1)
            .padStart(4, "0")
    );

}


// =====================================================
// API
// =====================================================

async function api(req, res) {

    try {


        // =================================================
        // LOGIN
        // =================================================

        if (
            req.method === "POST" &&
            req.url === "/api/login"
        ) {

            const b = await body(req);

            const user = db.users.find(
                x =>
                    x.username === b.username &&
                    x.password === b.password
            );


            if (!user) {

                return json(
                    res,
                    401,
                    {
                        error:
                            "Invalid username or password"
                    }
                );

            }


            const token =
                crypto.randomUUID();


            const session = {

                id: user.id,
                name: user.name,
                username: user.username,
                role: user.role

            };


            sessions.set(
                token,
                session
            );


            return json(
                res,
                200,
                {
                    token,
                    user: session
                }
            );

        }


        // =================================================
        // AUTHENTICATION
        // =================================================

        const user =
            getUser(req);


        if (!user) {

            return json(
                res,
                401,
                {
                    error:
                        "Please login"
                }
            );

        }


        // =================================================
        // CURRENT USER
        // =================================================

        if (
            req.method === "GET" &&
            req.url === "/api/me"
        ) {

            return json(
                res,
                200,
                {
                    user
                }
            );

        }


        // =================================================
        // PRODUCTS GET
        // =================================================

        if (
            req.method === "GET" &&
            req.url === "/api/products"
        ) {

            return json(
                res,
                200,
                db.products.map(
                    publicProduct
                )
            );

        }


        // =================================================
        // DASHBOARD
        // =================================================

        if (
            req.method === "GET" &&
            req.url === "/api/dashboard"
        ) {

            const today =
                new Date()
                    .toISOString()
                    .slice(0, 10);


            const sales =
                db.sales.filter(
                    x =>
                        x.time.slice(0, 10) === today
                );


            const totalSales =
                sales.reduce(
                    (sum, sale) =>
                        sum + sale.total,
                    0
                );


            const bills =
                sales.length;


            const sticks =
                sales.reduce(
                    (sum, sale) =>
                        sum +
                        sale.items.reduce(
                            (q, item) =>
                                q + item.qty,
                            0
                        ),
                    0
                );


            const low =
                db.products.filter(
                    x => status(x) === "LOW"
                ).length;


            const out =
                db.products.filter(
                    x => status(x) === "OUT"
                ).length;


            return json(
                res,
                200,
                {
                    sales: totalSales,
                    bills,
                    sticks,
                    products:
                        db.products.length,
                    low,
                    out
                }
            );

        }


        // =================================================
        // SALES
        // =================================================

        if (
            req.method === "GET" &&
            req.url === "/api/sales"
        ) {

            return json(
                res,
                200,
                db.sales
                    .slice()
                    .reverse()
            );

        }


        // =================================================
        // ADD PRODUCT
        // =================================================

        if (
            req.method === "POST" &&
            req.url === "/api/products"
        ) {


            if (
                user.role === "Billing Staff"
            ) {

                return json(
                    res,
                    403,
                    {
                        error:
                            "Not allowed"
                    }
                );

            }


            const b =
                await body(req);


            if (
                !b.name ||
                Number(b.price) < 0
            ) {

                return json(
                    res,
                    400,
                    {
                        error:
                            "Invalid product"
                    }
                );

            }


            const product = {

                id:
                    "P" +
                    Date.now()
                        .toString()
                        .slice(-6),

                name:
                    b.name,

                price:
                    Number(b.price),

                stock: 0,

                minStock:
                    Number(
                        b.minStock || 10
                    ),

                emoji:
                    b.emoji || "🍦",

                bg:
                    b.bg || "blue"

            };


            db.products.push(
                product
            );


            save();


            return json(
                res,
                200,
                publicProduct(product)
            );

        }


        // =================================================
        // STOCK IN
        // =================================================

        if (
            req.method === "POST" &&
            req.url === "/api/stock"
        ) {


            if (
                user.role === "Billing Staff"
            ) {

                return json(
                    res,
                    403,
                    {
                        error:
                            "Not allowed"
                    }
                );

            }


            const b =
                await body(req);


            const product =
                db.products.find(
                    x =>
                        x.id ===
                        b.productId
                );


            const qty =
                Number(b.boxes || 0) * 24 +
                Number(b.sticks || 0);


            if (
                !product ||
                qty <= 0
            ) {

                return json(
                    res,
                    400,
                    {
                        error:
                            "Invalid stock"
                    }
                );

            }


            product.stock += qty;


            db.movements.push({

                time:
                    new Date().toISOString(),

                type:
                    "STOCK IN",

                productId:
                    product.id,

                product:
                    product.name,

                qty,

                staff:
                    user.name

            });


            save();


            return json(
                res,
                200,
                publicProduct(product)
            );

        }


        // =================================================
        // DAMAGE
        // =================================================

        if (
            req.method === "POST" &&
            req.url === "/api/damage"
        ) {


            if (
                user.role === "Billing Staff"
            ) {

                return json(
                    res,
                    403,
                    {
                        error:
                            "Not allowed"
                    }
                );

            }


            const b =
                await body(req);


            const product =
                db.products.find(
                    x =>
                        x.id ===
                        b.productId
                );


            const qty =
                Number(b.qty);


            if (
                !product ||
                qty <= 0 ||
                product.stock < qty
            ) {

                return json(
                    res,
                    400,
                    {
                        error:
                            "Invalid damaged quantity"
                    }
                );

            }


            product.stock -= qty;


            db.movements.push({

                time:
                    new Date().toISOString(),

                type:
                    "DAMAGE",

                productId:
                    product.id,

                product:
                    product.name,

                qty:
                    -qty,

                staff:
                    user.name

            });


            save();


            return json(
                res,
                200,
                publicProduct(product)
            );

        }


        // =================================================
        // BILLING
        // =================================================

        if (
            req.method === "POST" &&
            req.url === "/api/bills"
        ) {


            if (
                user.role === "Stock Staff"
            ) {

                return json(
                    res,
                    403,
                    {
                        error:
                            "Stock staff cannot bill"
                    }
                );

            }


            const b =
                await body(req);


            if (
                !Array.isArray(b.items) ||
                b.items.length === 0
            ) {

                return json(
                    res,
                    400,
                    {
                        error:
                            "Cart is empty"
                    }
                );

            }


            let total = 0;

            const items = [];


            // Check stock first

            for (
                const item of b.items
            ) {

                const product =
                    db.products.find(
                        x =>
                            x.id ===
                            item.productId
                    );


                const qty =
                    Number(item.qty);


                if (
                    !product ||
                    qty < 1 ||
                    product.stock < qty
                ) {

                    return json(
                        res,
                        400,
                        {
                            error:
                                `Not enough stock for ${
                                    product
                                        ? product.name
                                        : "item"
                                }`
                        }
                    );

                }


                items.push({

                    productId:
                        product.id,

                    name:
                        product.name,

                    price:
                        product.price,

                    qty,

                    line:
                        product.price * qty

                });


                total +=
                    product.price * qty;

            }


            // Deduct stock

            for (
                const item of items
            ) {

                const product =
                    db.products.find(
                        x =>
                            x.id ===
                            item.productId
                    );


                product.stock -=
                    item.qty;


                db.movements.push({

                    time:
                        new Date().toISOString(),

                    type:
                        "SALE",

                    productId:
                        product.id,

                    product:
                        product.name,

                    qty:
                        -item.qty,

                    staff:
                        user.name

                });

            }


            const discount =
                Number(
                    b.discount || 0
                );


            const sale = {

                id:
                    crypto.randomUUID(),

                billNo:
                    billNo(),

                time:
                    new Date().toISOString(),

                staff:
                    user.name,

                payment:
                    b.payment || "Cash",

                discount,

                total:
                    Math.max(
                        0,
                        total - discount
                    ),

                items

            };


            db.sales.push(
                sale
            );


            save();


            return json(
                res,
                200,
                sale
            );

        }


        // =================================================
        // DAILY REPORT
        // =================================================

        if (
            req.method === "GET" &&
            req.url === "/api/reports/daily"
        ) {

            const daily = {};


            for (
                const sale of db.sales
            ) {

                const date =
                    sale.time.slice(
                        0,
                        10
                    );


                if (!daily[date]) {

                    daily[date] = {

                        date,

                        sales: 0,

                        bills: 0,

                        sticks: 0,

                        cash: 0,

                        upi: 0,

                        card: 0

                    };

                }


                daily[date].sales +=
                    sale.total;


                daily[date].bills +=
                    1;


                daily[date].sticks +=
                    sale.items.reduce(
                        (sum, item) =>
                            sum + item.qty,
                        0
                    );


                if (
                    sale.payment === "Cash"
                ) {

                    daily[date].cash +=
                        sale.total;

                }


                if (
                    sale.payment === "UPI"
                ) {

                    daily[date].upi +=
                        sale.total;

                }


                if (
                    sale.payment === "Card"
                ) {

                    daily[date].card +=
                        sale.total;

                }

            }


            return json(
                res,
                200,
                Object.values(daily)
                    .sort(
                        (a, b) =>
                            b.date.localeCompare(
                                a.date
                            )
                    )
            );

        }


        // =================================================
        // REPORT SUMMARY
        // =================================================

        if (
            req.method === "GET" &&
            req.url === "/api/reports/summary"
        ) {

            const summary = {

                totalSales: 0,

                totalBills: 0,

                sticksSold: 0,

                cash: 0,

                upi: 0,

                card: 0

            };


            for (
                const sale of db.sales
            ) {

                summary.totalSales +=
                    sale.total;


                summary.totalBills +=
                    1;


                summary.sticksSold +=
                    sale.items.reduce(
                        (sum, item) =>
                            sum + item.qty,
                        0
                    );


                if (
                    sale.payment === "Cash"
                ) {

                    summary.cash +=
                        sale.total;

                }


                if (
                    sale.payment === "UPI"
                ) {

                    summary.upi +=
                        sale.total;

                }


                if (
                    sale.payment === "Card"
                ) {

                    summary.card +=
                        sale.total;

                }

            }


            return json(
                res,
                200,
                summary
            );

        }


        // =================================================
        // RESET REPORTS
        // ADMIN ONLY
        // =================================================

        if (
            req.method === "POST" &&
            req.url === "/api/reports/reset"
        ) {


            if (
                user.role !== "Admin"
            ) {

                return json(
                    res,
                    403,
                    {
                        error:
                            "Admin only"
                    }
                );

            }


            const backupDir =
                path.join(
                    __dirname,
                    "data",
                    "report-backups"
                );


            if (
                !fs.existsSync(
                    backupDir
                )
            ) {

                fs.mkdirSync(
                    backupDir,
                    {
                        recursive: true
                    }
                );

            }


            const backupName =
                `sales-${new Date()
                    .toISOString()
                    .replace(/[:.]/g, "-")
                }.json`;


            const backupFile =
                path.join(
                    backupDir,
                    backupName
                );


            fs.writeFileSync(
                backupFile,
                JSON.stringify(
                    db.sales,
                    null,
                    2
                )
            );


            // Clear sales only
            // Inventory remains

            db.sales = [];


            save();


            return json(
                res,
                200,
                {

                    success: true,

                    message:
                        "Reports reset successfully",

                    backup:
                        backupName

                }
            );

        }


        // =================================================
        // UNKNOWN API
        // =================================================

        return json(
            res,
            404,
            {
                error:
                    "API endpoint not found"
            }
        );


    } catch (error) {

        console.error(
            "API ERROR:",
            error
        );


        return json(
            res,
            500,
            {
                error:
                    error.message
            }
        );

    }

}


// =====================================================
// MIME TYPES
// =====================================================

const mime = {

    ".html":
        "text/html",

    ".css":
        "text/css",

    ".js":
        "application/javascript",

    ".json":
        "application/json",

    ".png":
        "image/png",

    ".jpg":
        "image/jpeg",

    ".jpeg":
        "image/jpeg",

    ".webp":
        "image/webp",

    ".gif":
        "image/gif",

    ".svg":
        "image/svg+xml"

};


// =====================================================
// STATIC FILE SERVER
// =====================================================

const server =
    http.createServer(
        (req, res) => {


            // =============================================
            // API
            // =============================================

            if (
                req.url.startsWith(
                    "/api/"
                )
            ) {

                return api(
                    req,
                    res
                );

            }


            // =============================================
            // FILE PATH
            // =============================================

            let p =
                decodeURIComponent(
                    req.url.split("?")[0]
                );


            // =============================================
            // HOMEPAGE
            // =============================================

            /*
                IMPORTANT

                http://localhost:3000
                opens customer.html
            */

            if (
                p === "/" ||
                p === "/index.html"
            ) {

                p =
                    "/customer.html";

            }


            // =============================================
            // FILE LOCATION
            // =============================================

            const filePath =
                path.normalize(
                    path.join(
                        ROOT,
                        p
                    )
                );


            // =============================================
            // SECURITY
            // =============================================

            if (
                !filePath.startsWith(
                    ROOT
                )
            ) {

                return json(
                    res,
                    403,
                    {
                        error:
                            "Forbidden"
                    }
                );

            }


            // =============================================
            // READ FILE
            // =============================================

            fs.readFile(
                filePath,
                (error, data) => {


                    if (error) {

                        console.error(
                            "FILE NOT FOUND:",
                            filePath
                        );


                        res.writeHead(
                            404,
                            {
                                "Content-Type":
                                    "text/plain"
                            }
                        );


                        return res.end(
                            "Not found: " + p
                        );

                    }


                    const extension =
                        path.extname(
                            filePath
                        ).toLowerCase();


                    res.writeHead(
                        200,
                        {

                            "Content-Type":
                                mime[
                                    extension
                                ] ||
                                "application/octet-stream",

                            "Cache-Control":
                                "no-store"

                        }
                    );


                    res.end(data);

                }
            );

        }
    );


// =====================================================
// START SERVER
// =====================================================

server.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            "=========================================="
        );

        console.log(
            "       PAPINOICE SERVER STARTED"
        );

        console.log(
            "=========================================="
        );

        console.log(
            `Website: http://localhost:${PORT}`
        );

        console.log(
            `Customer: http://localhost:${PORT}/customer.html`
        );

        console.log(
            `Login: http://localhost:${PORT}/login.html`
        );

        console.log(
            "=========================================="
        );

    }
);