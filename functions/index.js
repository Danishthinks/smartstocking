const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });
const fetch = require("node-fetch");
const nodemailer = require("nodemailer");
require("dotenv").config();

admin.initializeApp();

const LOW_STOCK_THRESHOLD = 5;
const DEFAULT_STORE_NAME = "inkandemotion.store";

let cachedTransporter = null;
function getMailer() {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("Missing SMTP configuration");
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  return cachedTransporter;
}

function buildLowStockMessage(product, threshold) {
  const name = product?.name || "Product";
  const productId = product?.productId ? ` (${product.productId})` : "";
  const warehouse = product?.warehouse || "Unassigned";
  const quantity = Number(product?.quantity ?? 0);
  const subject = `Low stock alert: ${name}${productId}`;
  const text =
    `Low stock alert for ${name}${productId}\n` +
    `Quantity: ${quantity}\n` +
    `Warehouse: ${warehouse}\n` +
    `Threshold: ${threshold}`;
  const html = `
    <p><strong>Low stock alert</strong></p>
    <p>Product: ${name}${productId}</p>
    <p>Quantity: ${quantity}</p>
    <p>Warehouse: ${warehouse}</p>
    <p>Threshold: ${threshold}</p>
  `;

  return { subject, text, html };
}

function buildStoreProductPayload(productDoc) {
  const product = productDoc.data() || {};
  if (product.showOnStore === false) {
    return null;
  }

  return {
    id: productDoc.id,
    productId: product.productId || productDoc.id,
    name: product.name || "Product",
    category: product.category || "",
    description: product.description || "",
    imageUrl: product.imageUrl || product.photoUrl || "",
    barcode: product.barcode || "",
    warehouse: product.warehouse || "",
    quantity: Number(product.quantity ?? 0),
    threshold: Number(product.threshold ?? LOW_STOCK_THRESHOLD),
    purchasePrice: Number(product.purchasePrice ?? 0),
    sellingPrice: Number(product.sellingPrice ?? 0),
    ptaStatus: product.ptaStatus || "",
    updatedAt: product.updatedAt || null
  };
}

function normalizeOrderItem(item) {
  return {
    productDocId: String(item?.productDocId || item?.id || item?.productId || "").trim(),
    productId: String(item?.productId || "").trim(),
    sku: String(item?.sku || item?.variantSku || "").trim(),
    quantity: Number(item?.quantity ?? item?.quantitySold ?? 0)
  };
}

function buildExistingOrderResponse(orderDoc) {
  const data = orderDoc.data() || {};
  return {
    orderId: data.orderId || orderDoc.id,
    orderRef: orderDoc.id,
    items: data.items || [],
    subtotal: Number(data.subtotal ?? 0),
    shippingFee: Number(data.shippingFee ?? 0),
    discountTotal: Number(data.discountTotal ?? 0),
    grandTotal: Number(data.grandTotal ?? 0),
    customer: data.customer || {},
    paymentStatus: data.paymentStatus || "paid",
    paymentMethod: data.paymentMethod || "online",
    source: data.source || data.sourceUrl || DEFAULT_STORE_NAME,
    storeName: data.storeName || DEFAULT_STORE_NAME,
    sourceUrl: data.sourceUrl || data.source || DEFAULT_STORE_NAME,
    integrationLabel: data.integrationLabel || `${data.storeName || DEFAULT_STORE_NAME} via ${data.sourceUrl || data.source || DEFAULT_STORE_NAME}`,
    deduplicated: true
  };
}

async function resolveProductSnapshot(transaction, item) {
  const productsRef = admin.firestore().collection("products");

  if (item.productDocId) {
    const directRef = productsRef.doc(item.productDocId);
    const directSnap = await transaction.get(directRef);
    if (directSnap.exists) {
      return { ref: directRef, snapshot: directSnap };
    }
  }

  if (item.productId) {
    const byProductId = await transaction.get(
      productsRef.where("productId", "==", item.productId).limit(1)
    );
    if (!byProductId.empty) {
      return { ref: byProductId.docs[0].ref, snapshot: byProductId.docs[0] };
    }
  }

  if (item.sku) {
    const bySku = await transaction.get(
      productsRef.where("sku", "==", item.sku).limit(1)
    );
    if (!bySku.empty) {
      return { ref: bySku.docs[0].ref, snapshot: bySku.docs[0] };
    }
  }

  const debugToken = item.productDocId || item.productId || item.sku || "unknown";
  throw new Error(`Product not found for identifier: ${debugToken}`);
}

function isEligibleForSalesRecord(paymentStatus, recordSale) {
  if (recordSale === false) return false;
  return ["paid", "confirmed", "completed", "cod"].includes(String(paymentStatus || "").toLowerCase());
}

async function sendOrderEmail({ to, subject, text, html }) {
  if (!to) return false;

  let transporter;
  try {
    transporter = getMailer();
  } catch (err) {
    return false;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) return false;

  await transporter.sendMail({ from, to, subject, text, html });
  return true;
}

function buildCustomerOrderEmail(order) {
  const itemRows = (order.items || [])
    .map(
      (item) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${item.productName}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">PKR ${Number(item.salePrice || 0).toFixed(2)}</td></tr>`
    )
    .join("");

  const customerName = order.customer?.name || "Customer";
  const grandTotal = Number(order.grandTotal ?? order.subtotal ?? 0).toFixed(2);

  return {
    subject: `Order confirmation: ${order.orderId}`,
    text:
      `Hi ${customerName},\n\n` +
      `Your order ${order.orderId} has been received.\n` +
      `Total: PKR ${grandTotal}\n\n` +
      `Thank you for shopping with us.`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.6;">
        <h2 style="margin:0 0 12px;">Order confirmation</h2>
        <p style="margin:0 0 16px;">Hi <strong>${customerName}</strong>, your order <strong>${order.orderId}</strong> has been received.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d1d5db;">Item</th>
              <th style="text-align:center;padding:8px 10px;border-bottom:2px solid #d1d5db;">Qty</th>
              <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #d1d5db;">Total</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>
        <p style="font-size:16px;font-weight:bold;">Grand Total: PKR ${grandTotal}</p>
      </div>
    `
  };
}

async function createEcommerceOrder(payload) {
  const items = Array.isArray(payload?.items) ? payload.items.map(normalizeOrderItem) : [];
  const validItems = items.filter(
    (item) =>
      Number.isInteger(item.quantity) &&
      item.quantity > 0 &&
      Boolean(item.productDocId || item.productId || item.sku)
  );

  if (validItems.length === 0) {
    throw new Error("At least one valid item is required");
  }

  const customer = payload?.customer || {};
  const shippingAddress = payload?.shippingAddress || {};
  const paymentMethod = String(payload?.paymentMethod || "online").trim();
  const paymentStatus = String(payload?.paymentStatus || "paid").trim().toLowerCase();
  const sourceUrl = String(payload?.sourceUrl || payload?.source || DEFAULT_STORE_NAME).trim();
  const storeName = String(payload?.storeName || DEFAULT_STORE_NAME).trim();
  const externalOrderId = String(payload?.externalOrderId || payload?.checkoutId || payload?.orderId || "").trim();
  const idempotencyKey = String(payload?.idempotencyKey || "").trim();
  const notes = String(payload?.notes || "").trim();
  const shippingFee = Number(payload?.shippingFee ?? 0);
  const discountTotal = Number(payload?.discountTotal ?? 0);
  const recordSale = payload?.recordSale !== false;
  const orderNumber = `ECOM-${Date.now()}`;

  const dedupeToken = idempotencyKey || externalOrderId;
  if (dedupeToken) {
    const existingByToken = await admin
      .firestore()
      .collection("ecommerceOrders")
      .where("source", "==", sourceUrl)
      .where("dedupeToken", "==", dedupeToken)
      .limit(1)
      .get();

    if (!existingByToken.empty) {
      return buildExistingOrderResponse(existingByToken.docs[0]);
    }
  }

  const result = await admin.firestore().runTransaction(async (transaction) => {
    const loadedItems = [];

    for (const item of validItems) {
      const { ref: productRef, snapshot: productSnapshot } = await resolveProductSnapshot(transaction, item);

      const product = productSnapshot.data() || {};
      const liveQuantity = Number(product.quantity ?? 0);
      const quantity = Number(item.quantity);
      const unitPrice = Number(product.sellingPrice ?? 0);

      if (quantity > liveQuantity) {
        throw new Error(`Insufficient stock for ${product.name || item.productDocId}`);
      }

      const newQuantity = liveQuantity - quantity;
      transaction.update(productRef, {
        quantity: newQuantity,
        lastUpdatedBy: null
      });

      loadedItems.push({
        productDocId: productRef.id,
        productId: product.productId || productRef.id,
        productName: product.name || "Product",
        quantity,
        unitPrice,
        salePrice: Number((unitPrice * quantity).toFixed(2)),
        remainingStock: newQuantity
      });
    }

    const subtotal = Number(
      loadedItems.reduce((sum, item) => sum + Number(item.salePrice || 0), 0).toFixed(2)
    );
    const grandTotal = Number((subtotal + shippingFee - discountTotal).toFixed(2));
    const orderRef = admin.firestore().collection("ecommerceOrders").doc();

    const orderData = {
      orderId: orderNumber,
      orderNumber,
      source: sourceUrl,
      storeName,
      sourceUrl,
      status: paymentStatus === "paid" ? "confirmed" : "processing",
      orderStatus: paymentStatus === "paid" ? "confirmed" : "processing",
      paymentMethod,
      paymentStatus,
      customer: {
        name: String(customer.name || "").trim(),
        email: String(customer.email || "").trim(),
        phone: String(customer.phone || "").trim()
      },
      customerName: String(customer.name || "").trim(),
      customerEmail: String(customer.email || "").trim(),
      customerPhone: String(customer.phone || "").trim(),
      shippingAddress: {
        line1: String(shippingAddress.line1 || shippingAddress.address1 || "").trim(),
        line2: String(shippingAddress.line2 || shippingAddress.address2 || "").trim(),
        city: String(shippingAddress.city || "").trim(),
        state: String(shippingAddress.state || "").trim(),
        postalCode: String(shippingAddress.postalCode || shippingAddress.zip || "").trim(),
        country: String(shippingAddress.country || "Pakistan").trim()
      },
      items: loadedItems,
      subtotal,
      shippingFee: Number(shippingFee.toFixed(2)),
      discountTotal: Number(discountTotal.toFixed(2)),
      grandTotal,
      totalAmount: grandTotal,
      notes,
      integrationLabel: `${storeName} via ${sourceUrl}`,
      externalOrderId: externalOrderId || null,
      idempotencyKey: idempotencyKey || null,
      dedupeToken: dedupeToken || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: "storefront"
    };

    transaction.set(orderRef, orderData);

    if (isEligibleForSalesRecord(paymentStatus, recordSale)) {
      const saleRef = admin.firestore().collection("sales").doc();
      transaction.set(saleRef, {
        orderId: orderNumber,
        source: "ecommerce",
        channel: "online",
        productIds: loadedItems.map((item) => item.productId),
        productNames: loadedItems.map((item) => item.productName),
        items: loadedItems.map((item) => ({
          productDocId: item.productDocId,
          productId: item.productId,
          productName: item.productName,
          quantitySold: item.quantity,
          unitPrice: item.unitPrice,
          salePrice: item.salePrice
        })),
        totalItems: loadedItems.length,
        totalQuantity: loadedItems.reduce((sum, item) => sum + item.quantity, 0),
        salePrice: grandTotal,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        soldBy: "storefront",
        soldByEmail: customer.email || null
      });
    }

    transaction.set(admin.firestore().collection("logs").doc(), {
      user: "storefront",
      action: "ECOMMERCE ORDER",
      productName: orderNumber,
      quantity: loadedItems.reduce((sum, item) => sum + item.quantity, 0),
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      orderId: orderNumber,
      orderRef: orderRef.id,
      items: loadedItems,
      subtotal,
      shippingFee: Number(shippingFee.toFixed(2)),
      discountTotal: Number(discountTotal.toFixed(2)),
      grandTotal,
      customer,
      paymentStatus,
      paymentMethod,
      source: sourceUrl,
      storeName,
      sourceUrl,
      integrationLabel: `${storeName} via ${sourceUrl}`,
      externalOrderId: externalOrderId || null,
      idempotencyKey: idempotencyKey || null,
      dedupeToken: dedupeToken || null
    };
  });

  if (result.customer?.email) {
    const { subject, text, html } = buildCustomerOrderEmail({
      orderId: result.orderId,
      customer: result.customer,
      items: result.items,
      grandTotal: result.grandTotal
    });

    await sendOrderEmail({
      to: result.customer.email,
      subject,
      text,
      html
    }).catch(() => {});
  }

  return result;
}

async function restockCancelledOrder(orderData) {
  const items = Array.isArray(orderData?.items) ? orderData.items : [];
  if (items.length === 0) {
    return null;
  }

  await admin.firestore().runTransaction(async (transaction) => {
    for (const item of items) {
      const productId = String(item.productDocId || "").trim();
      if (!productId) continue;

      const productRef = admin.firestore().collection("products").doc(productId);
      const productSnapshot = await transaction.get(productRef);
      if (!productSnapshot.exists) continue;

      const product = productSnapshot.data() || {};
      const currentQuantity = Number(product.quantity ?? 0);
      const restoreQuantity = Number(item.quantity ?? item.quantitySold ?? 0);

      transaction.update(productRef, {
        quantity: currentQuantity + restoreQuantity,
        lastUpdatedBy: null
      });
    }

    transaction.set(admin.firestore().collection("logs").doc(), {
      user: "storefront",
      action: "ECOMMERCE ORDER CANCELLED",
      productName: orderData.orderId || "Ecommerce order",
      quantity: Number(orderData.totalQuantity ?? 0),
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  return true;
}

exports.groqChat = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GROQ API key not configured" });
    }

    const { messages, model } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid messages array" });
    }

    try {
      const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: model || "llama-3.1-8b",
            messages
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: data });
      }

      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message || "Server error" });
    }
  });
});

exports.notifyCrud = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required");
  }

  const title = data?.title || "SmartStock";
  const body = data?.body || "Inventory updated";

  const tokensSnap = await admin.firestore().collection("fcmTokens").get();
  const tokens = tokensSnap.docs.map((doc) => doc.id).filter(Boolean);

  if (tokens.length === 0) {
    return { success: true, sent: 0 };
  }

  const chunks = [];
  for (let i = 0; i < tokens.length; i += 500) {
    chunks.push(tokens.slice(i, i + 500));
  }

  let sent = 0;
  for (const chunk of chunks) {
    const result = await admin.messaging().sendEachForMulticast({
      tokens: chunk,
      notification: { title, body }
    });
    sent += result.successCount;
  }

  return { success: true, sent };
});

exports.notifyLowStockEmail = functions.firestore
  .document("products/{productId}")
  .onWrite(async (change) => {
    if (!change.after.exists) {
      return null;
    }

    const after = change.after.data() || {};
    const before = change.before.exists ? change.before.data() : null;
    const afterQty = Number(after.quantity ?? 0);
    const beforeQty = Number(before?.quantity ?? Number.POSITIVE_INFINITY);
    const productThreshold = Number(after.threshold ?? LOW_STOCK_THRESHOLD);

    const crossedThreshold =
      afterQty < productThreshold &&
      (before == null || beforeQty >= productThreshold);

    if (!crossedThreshold) {
      return null;
    }

    const uid = after.lastUpdatedBy || after.createdBy;
    if (!uid) {
      return null;
    }

    let user;
    try {
      user = await admin.auth().getUser(uid);
    } catch (err) {
      console.error("Low stock email: user lookup failed", err);
      return null;
    }

    if (!user.email) {
      return null;
    }

    let transporter;
    try {
      transporter = getMailer();
    } catch (err) {
      console.error("Low stock email: SMTP not configured", err);
      return null;
    }

    const { subject, text, html } = buildLowStockMessage(after, productThreshold);
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;

    try {
      await transporter.sendMail({
        from,
        to: user.email,
        subject,
        text,
        html
      });

      // Send restock request to vendor if their email is stored on the product
      if (after.vendorEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(after.vendorEmail)) {
        const name = after.name || "Product";
        const productId = after.productId ? ` (${after.productId})` : "";
        const warehouse = after.warehouse || "Unassigned";
        const quantity = Number(after.quantity ?? 0);
        const vendorName = after.vendorName || "Valued Vendor";
        const vendorSubject = `Restock Request: ${name}${productId}`;
        const vendorTextBody =
          `Dear ${vendorName},\n\n` +
          `We are reaching out to request a restock for the following product:\n\n` +
          `Product: ${name}${productId}\n` +
          `Current Stock: ${quantity} units\n` +
          `Warehouse: ${warehouse}\n` +
          `Restock Threshold: ${productThreshold} units\n\n` +
          `Please contact us at your earliest convenience to arrange resupply.\n\n` +
          `Thank you,\nSmartStock Team`;
        const vendorHtml = `
          <p>Dear <strong>${vendorName}</strong>,</p>
          <p>We are reaching out to request a restock for the following product:</p>
          <table style="border-collapse:collapse;margin:12px 0;">
            <tr><td style="padding:4px 16px 4px 0;font-weight:bold;color:#374151;">Product:</td><td>${name}${productId}</td></tr>
            <tr><td style="padding:4px 16px 4px 0;font-weight:bold;color:#374151;">Current Stock:</td><td style="color:#dc2626;font-weight:bold;">${quantity} units</td></tr>
            <tr><td style="padding:4px 16px 4px 0;font-weight:bold;color:#374151;">Warehouse:</td><td>${warehouse}</td></tr>
            <tr><td style="padding:4px 16px 4px 0;font-weight:bold;color:#374151;">Restock Threshold:</td><td>${productThreshold} units</td></tr>
          </table>
          <p>Please contact us at your earliest convenience to arrange resupply.</p>
          <p>Thank you,<br/><strong>SmartStock Team</strong></p>
        `;
        try {
          await transporter.sendMail({
            from,
            to: after.vendorEmail,
            subject: vendorSubject,
            text: vendorTextBody,
            html: vendorHtml
          });
        } catch (vendorErr) {
          console.error("Vendor restock email failed:", vendorErr);
        }
      }
    } catch (err) {
      console.error("Low stock email: send failed", err);
    }

    return null;
  });

exports.ecommerceCatalog = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      const snapshot = await admin.firestore().collection("products").get();
      const products = [];

      snapshot.forEach((doc) => {
        const payload = buildStoreProductPayload(doc);
        if (payload) {
          products.push(payload);
        }
      });

      return res.status(200).json({ success: true, products });
    } catch (err) {
      console.error("Catalog fetch failed:", err);
      return res.status(500).json({ error: err.message || "Server error" });
    }
  });
});

exports.createEcommerceOrder = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      const result = await createEcommerceOrder(req.body || {});
      return res.status(200).json({ success: true, ...result });
    } catch (err) {
      console.error("Ecommerce order create failed:", err);
      return res.status(400).json({ error: err.message || "Order creation failed" });
    }
  });
});

exports.syncEcommerceOrderStatus = functions.firestore
  .document("ecommerceOrders/{orderId}")
  .onUpdate(async (change) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const previousStatus = String(before.status || "").toLowerCase();
    const nextStatus = String(after.status || "").toLowerCase();

    if (previousStatus === nextStatus) {
      return null;
    }

    if (["cancelled", "canceled", "refunded"].includes(nextStatus) && !["cancelled", "canceled", "refunded"].includes(previousStatus)) {
      await restockCancelledOrder(after);
      return null;
    }

    await admin.firestore().collection("logs").add({
      user: "storefront",
      action: "ECOMMERCE ORDER STATUS",
      productName: after.orderId || "Ecommerce order",
      quantity: Number(after.totalQuantity ?? 0),
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return null;
  });

/**
 * ============================================
 * InkandEmotion Store Integration Functions
 * ============================================
 */

/**
 * Sync Product Queue Processor
 * Processes pending product sync requests to InkandEmotion
 */
exports.processProductSyncQueue = functions.firestore
  .document("productSyncQueue/{syncId}")
  .onCreate(async (snap) => {
    const syncData = snap.data() || {};
    
    if (syncData.status !== "pending") {
      return null;
    }

    try {
      // Queue product for InkandEmotion API
      const webhookUrl = process.env.INKANDEMOTION_WEBHOOK_PRODUCT || null;
      
      if (webhookUrl) {
        try {
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: syncData.action || "create",
              product: {
                productId: syncData.productId,
                name: syncData.name,
                category: syncData.category,
                sellingPrice: syncData.sellingPrice,
                purchasePrice: syncData.purchasePrice,
                quantity: syncData.quantity,
                barcode: syncData.barcode,
                vendorName: syncData.vendorName,
                warehouse: syncData.warehouse
              }
            })
          });
        } catch (webhookErr) {
          console.error("Webhook failed, will retry:", webhookErr);
        }
      }

      // Mark as synced
      await snap.ref.update({
        status: "synced",
        syncedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log("Product synced:", syncData.productId);
    } catch (error) {
      console.error("Product sync error:", error);
      
      // Mark as failed but don't retry automatically
      await snap.ref.update({
        status: "failed",
        error: error.message,
        failedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return null;
  });

/**
 * Sync Inventory Queue Processor
 * Processes pending inventory updates to InkandEmotion
 */
exports.processInventorySyncQueue = functions.firestore
  .document("inventorySyncQueue/{syncId}")
  .onCreate(async (snap) => {
    const syncData = snap.data() || {};

    try {
      const webhookUrl = process.env.INKANDEMOTION_WEBHOOK_INVENTORY || null;
      
      if (webhookUrl) {
        try {
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "update_inventory",
              inventory: {
                productId: syncData.productId,
                quantity: syncData.quantity,
                warehouse: syncData.warehouse,
                timestamp: new Date().toISOString()
              }
            })
          });
        } catch (webhookErr) {
          console.error("Inventory webhook failed:", webhookErr);
        }
      }

      await snap.ref.update({
        status: "synced",
        syncedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log("Inventory synced for:", syncData.productId);
    } catch (error) {
      console.error("Inventory sync error:", error);
      
      await snap.ref.update({
        status: "failed",
        error: error.message,
        failedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return null;
  });

/**
 * Sync Order Status Queue Processor
 * Sends order status updates back to InkandEmotion
 */
exports.processOrderStatusSyncQueue = functions.firestore
  .document("orderStatusSyncQueue/{syncId}")
  .onCreate(async (snap) => {
    const syncData = snap.data() || {};

    try {
      const webhookUrl = process.env.INKANDEMOTION_WEBHOOK_ORDERS || null;
      
      if (webhookUrl) {
        try {
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "update_order_status",
              order: {
                orderId: syncData.orderId,
                externalOrderId: syncData.externalOrderId,
                status: syncData.status,
                paymentStatus: syncData.paymentStatus,
                lastUpdatedAt: syncData.lastUpdatedAt
              }
            })
          });
        } catch (webhookErr) {
          console.error("Order status webhook failed:", webhookErr);
        }
      }

      await snap.ref.update({
        status: "synced",
        syncedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log("Order status synced:", syncData.orderId);
    } catch (error) {
      console.error("Order status sync error:", error);
      
      const retryCount = (syncData.retryCount || 0) + 1;
      if (retryCount < 3) {
        await snap.ref.update({
          status: "pending",
          retryCount,
          lastError: error.message,
          lastRetryAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        await snap.ref.update({
          status: "failed",
          error: error.message,
          failedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }

    return null;
  });

/**
 * Get Store Sync Status
 * Returns pending sync counts for monitoring dashboard
 */
exports.getSyncStatus = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      const productSyncDocs = await admin.firestore()
        .collection("productSyncQueue")
        .where("status", "==", "pending")
        .get();

      const inventorySyncDocs = await admin.firestore()
        .collection("inventorySyncQueue")
        .where("status", "==", "pending")
        .get();

      const orderStatusSyncDocs = await admin.firestore()
        .collection("orderStatusSyncQueue")
        .where("status", "==", "pending")
        .get();

      return res.status(200).json({
        success: true,
        status: {
          productSyncPending: productSyncDocs.size,
          inventorySyncPending: inventorySyncDocs.size,
          orderStatusSyncPending: orderStatusSyncDocs.size,
          totalPending: productSyncDocs.size + inventorySyncDocs.size + orderStatusSyncDocs.size,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to get sync status" });
    }
  });
});
