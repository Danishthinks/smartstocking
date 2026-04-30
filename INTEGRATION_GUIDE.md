# SmartStock ↔ InkandEmotion Integration Guide

## Overview

SmartStock is now fully integrated with **InkandEmotion**, providing seamless real-time sync of:
- ✅ Products (inventory items)
- ✅ Inventory levels (stock quantities)
- ✅ Orders (from store to dashboard)
- ✅ Order status (from dashboard back to store)
- ✅ Checkout flows (bidirectional)

## How It Works

### Architecture

```
InkandEmotion Store (Frontend)
        ↓
    Checkout
        ↓
SmartStock Firebase Functions (Backend)
        ↓
    Create Order
        ↓
    Deduct Inventory
        ↓
    SmartStock Dashboard
```

### Data Flow

#### 1. **Product Sync** (SmartStock → InkandEmotion)
- When you add a product in SmartStock Dashboard
- → Product is automatically queued for sync to InkandEmotion
- → InkandEmotion receives product via webhook
- → Product appears in your online store

#### 2. **Inventory Sync** (SmartStock ↔ InkandEmotion)
- Whenever inventory quantity changes in SmartStock
- → Update is automatically queued
- → InkandEmotion receives real-time inventory levels
- → Store displays accurate stock availability

#### 3. **Order Sync** (InkandEmotion → SmartStock)
- Customer places order on InkandEmotion store
- → Order sent to SmartStock Firebase function
- → Inventory automatically deducted
- → Order recorded in "Ecommerce Orders" section
- → Order confirmation email sent to customer

#### 4. **Order Status Sync** (SmartStock → InkandEmotion)
- You update order status in SmartStock Dashboard
- → Status change queued for sync
- → InkandEmotion receives status update via webhook
- → Customer notified of status change on store

## Setup Instructions

### Step 1: Configure Store Connection

1. Open SmartStock Dashboard
2. Click **"Store Sync"** in the left sidebar
3. Fill in the configuration form:

```
Store Name: inkandemotion.store
Store URL: https://yourstorename.com
API Key: (from your InkandEmotion admin panel)
Webhook URL: https://yourstorename.com/api/smartstock/webhook
```

4. Click **"Save Configuration"**

### Step 2: Configure Firebase Environment Variables

Add these to your Firebase functions `.env` file:

```env
# InkandEmotion Webhooks
INKANDEMOTION_WEBHOOK_PRODUCT=https://yourstorename.com/api/smartstock/products
INKANDEMOTION_WEBHOOK_INVENTORY=https://yourstorename.com/api/smartstock/inventory
INKANDEMOTION_WEBHOOK_ORDERS=https://yourstorename.com/api/smartstock/orders
```

### Step 3: Deploy Cloud Functions

```bash
cd functions
npm install
firebase deploy --only functions
```

### Step 4: Set Up InkandEmotion Webhooks (Optional)

If you want SmartStock to receive updates from InkandEmotion:

1. Go to InkandEmotion Admin Panel → Settings → Webhooks
2. Add new webhook for each event:
   - **Product Created**: `https://smartstock-ffa43.firebaseapp.com/v1/webhook/product-created`
   - **Order Created**: `https://smartstock-ffa43.firebaseapp.com/v1/webhook/order-created`
   - **Product Updated**: `https://smartstock-ffa43.firebaseapp.com/v1/webhook/product-updated`

## API Reference

### Cloud Functions

#### 1. `createEcommerceOrder`
Creates an order and deducts inventory.

**Endpoint**: `POST /createEcommerceOrder`

**Request Body**:
```json
{
  "items": [
    {
      "productId": "PROD-001",
      "quantity": 2
    }
  ],
  "customer": {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+92300000000"
  },
  "shippingAddress": {
    "line1": "123 Street",
    "city": "Karachi",
    "country": "Pakistan"
  },
  "shippingFee": 100,
  "discountTotal": 0,
  "paymentStatus": "paid",
  "paymentMethod": "online",
  "externalOrderId": "INK-12345",
  "storeName": "inkandemotion.store"
}
```

**Response**:
```json
{
  "orderId": "ECOM-1699564800000",
  "orderRef": "firestore-doc-id",
  "items": [...],
  "grandTotal": 5000,
  "paymentStatus": "paid",
  "customer": {...}
}
```

#### 2. `getSyncStatus`
Get current sync queue status.

**Endpoint**: `GET /getSyncStatus`

**Response**:
```json
{
  "success": true,
  "status": {
    "productSyncPending": 5,
    "inventorySyncPending": 3,
    "orderStatusSyncPending": 1,
    "totalPending": 9,
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

### Sync Service Functions (Frontend)

#### `configureStoreConnection(config)`
Save store connection settings.

```javascript
import { configureStoreConnection } from '@lib/inkandemotion-sync';

await configureStoreConnection({
  storeName: 'inkandemotion.store',
  storeUrl: 'https://inkandemotion.com',
  apiKey: 'your-api-key',
  webhookUrl: 'https://inkandemotion.com/webhook'
});
```

#### `syncProductToStore(productData)`
Queue a product for sync to InkandEmotion.

```javascript
import { syncProductToStore } from '@lib/inkandemotion-sync';

await syncProductToStore({
  productId: 'PROD-001',
  name: 'Product Name',
  category: 'Electronics',
  sellingPrice: 5000,
  purchasePrice: 3000,
  quantity: 10,
  barcode: '1234567890'
});
```

#### `syncInventoryUpdate(productId, quantity, warehouse)`
Queue inventory update for sync.

```javascript
import { syncInventoryUpdate } from '@lib/inkandemotion-sync';

await syncInventoryUpdate('PROD-001', 8, 'Warehouse A');
```

#### `listenToOrderStatusChanges(callback)`
Listen to order status changes and sync them.

```javascript
import { listenToOrderStatusChanges } from '@lib/inkandemotion-sync';

listenToOrderStatusChanges((event) => {
  if (event.type === 'orderStatusChanged') {
    console.log('Order updated:', event.order);
  }
});
```

#### `syncAllProducts()`
Manually trigger sync of all products.

```javascript
import { syncAllProducts } from '@lib/inkandemotion-sync';

const result = await syncAllProducts();
console.log(`Synced ${result.syncedCount} products`);
```

#### `getSyncQueueStatus()`
Get count of pending syncs.

```javascript
import { getSyncQueueStatus } from '@lib/inkandemotion-sync';

const status = await getSyncQueueStatus();
console.log(`Pending: ${status.totalPending} items`);
```

## Webhook Payload Formats

### Product Sync Webhook
SmartStock sends this when syncing products to InkandEmotion:

```json
{
  "action": "create",
  "product": {
    "productId": "PROD-001",
    "name": "Product Name",
    "category": "Electronics",
    "sellingPrice": 5000,
    "purchasePrice": 3000,
    "quantity": 10,
    "barcode": "1234567890",
    "vendorName": "Vendor Name",
    "warehouse": "Warehouse A"
  }
}
```

### Inventory Sync Webhook
SmartStock sends this when inventory changes:

```json
{
  "action": "update_inventory",
  "inventory": {
    "productId": "PROD-001",
    "quantity": 8,
    "warehouse": "Warehouse A",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

### Order Status Sync Webhook
SmartStock sends this when order status updates:

```json
{
  "action": "update_order_status",
  "order": {
    "orderId": "ECOM-1699564800000",
    "externalOrderId": "INK-12345",
    "status": "shipped",
    "paymentStatus": "paid",
    "lastUpdatedAt": "2024-01-15T10:30:00Z"
  }
}
```

## Monitoring & Troubleshooting

### View Sync Queue Status

1. Open SmartStock Dashboard
2. Go to **Store Sync** page
3. Check the **Sync Queue Status** section

Shows:
- Products Pending
- Inventory Updates Pending
- Order Status Updates Pending
- Total Pending Items

### Common Issues & Solutions

#### Issue: "Store connection not configured"
**Solution**: 
- Go to Store Sync page
- Fill in all required fields (marked with *)
- Click "Save Configuration"

#### Issue: Products not syncing
**Solution**:
1. Check if store is connected (green checkmark)
2. Check sync queue status on Store Sync page
3. Verify webhook URL in configuration
4. Check Firebase Cloud Functions are deployed

#### Issue: Inventory not updating on store
**Solution**:
1. Verify webhook URL is correct and accessible
2. Check Firebase console for function errors
3. Ensure `INKANDEMOTION_WEBHOOK_INVENTORY` env var is set
4. Check network logs for webhook requests

#### Issue: Orders not appearing in SmartStock
**Solution**:
1. Check if InkandEmotion is calling the createEcommerceOrder function
2. Verify product IDs match between systems
3. Check Firebase console logs for errors
4. Ensure payment status is set correctly

### Checking Logs

**Firebase Cloud Functions logs**:
```bash
firebase functions:log
```

**SmartStock Activity Logs**:
1. Dashboard → Activity Logs
2. Filter by action: "ECOMMERCE ORDER"

## File Structure

### New Files Created

```
src/
├── lib/
│   └── inkandemotion-sync.js          # Sync service functions
├── Pages/Dashboard/
│   └── StoreSync.jsx                  # Store configuration UI

functions/
├── index.js                           # Updated with new sync functions
│   ├── processProduc tSyncQueue()      # Handles product syncs
│   ├── processInventorySyncQueue()     # Handles inventory syncs
│   ├── processOrderStatusSyncQueue()   # Handles order status syncs
│   └── getSyncStatus()                 # Monitors sync queues
```

### Firestore Collections

```
smartstock-ffa43/
├── storeSyncConfig/
│   └── config                         # Store connection settings
├── productSyncQueue/
│   ├── {syncId}                       # Queued products
│   └── status: "pending|synced|failed"
├── inventorySyncQueue/
│   ├── {syncId}                       # Queued inventory updates
│   └── status: "pending|synced|failed"
├── orderStatusSyncQueue/
│   ├── {syncId}                       # Queued order status updates
│   └── status: "pending|synced|failed"
└── ecommerceOrders/
    └── {orderId}                      # All e-commerce orders
```

## Best Practices

1. **Regular Monitoring**: Check sync queue status daily
2. **Test Webhooks**: After setup, place a test order to verify flow
3. **Backup Products**: Regularly export product inventory
4. **Update Prices Strategically**: Batch price updates during off-hours
5. **Monitor Low Stock**: Enable low stock alerts for critical products
6. **Archive Orders**: Archive old orders to keep dashboard fast

## Security Notes

- Never share your API key with anyone
- Keep webhook URLs private and secure
- Use HTTPS for all webhook endpoints
- Validate webhook signatures (if supported by InkandEmotion)
- Rotate API keys periodically
- Monitor unauthorized access attempts

## Support & Feedback

For issues or feature requests:
1. Check the troubleshooting section above
2. Review Firebase Cloud Functions logs
3. Test with sample data first
4. Document the exact steps to reproduce issues

## Integration Checklist

- [ ] Configured store connection
- [ ] Set environment variables in Firebase
- [ ] Deployed Cloud Functions
- [ ] Verified webhook endpoints
- [ ] Tested product creation (should appear on store)
- [ ] Tested inventory updates
- [ ] Placed test order on store (should appear in SmartStock)
- [ ] Updated order status (should sync to store)
- [ ] Monitored sync queue for errors
- [ ] Trained team on Store Sync page usage

## API Endpoints Quick Reference

| Function | Method | Path | Purpose |
|----------|--------|------|---------|
| `createEcommerceOrder` | POST | /createEcommerceOrder | Create order from store |
| `getSyncStatus` | GET | /getSyncStatus | Monitor sync queues |
| `groqChat` | POST | /groqChat | Smart pricing (existing) |
| `notifyCrud` | CALL | notifyCrud | Send notifications (existing) |

---

**Last Updated**: 2024-01-15
**Integration Version**: 1.0.0
