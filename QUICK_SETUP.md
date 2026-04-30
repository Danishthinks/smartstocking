# SmartStock ↔ InkandEmotion Integration - Quick Setup

## ⚡ 5-Minute Setup Guide

### What's New
✅ **Automatic Product Sync** - Add products in SmartStock, they appear on InkandEmotion  
✅ **Real-time Inventory** - Stock levels sync instantly  
✅ **Order Auto-Processing** - Orders from store auto-create in SmartStock with inventory deduction  
✅ **Status Sync** - Update order status in SmartStock, it syncs back to store  
✅ **Checkout Integration** - Seamless bidirectional checkout flow  

---

## 🚀 Step-by-Step Setup

### 1. Configure Store Connection (2 minutes)
```
Dashboard → Store Sync → Store Configuration
```
Fill in:
- **Store URL**: https://yourstorename.com
- **API Key**: Get from InkandEmotion admin settings
- **Webhook URL**: https://yourstorename.com/api/smartstock/webhook

Click **"Save Configuration"** ✓

### 2. Add Environment Variables (1 minute)
In Firebase functions `.env`:
```
INKANDEMOTION_WEBHOOK_PRODUCT=https://yourstorename.com/api/smartstock/products
INKANDEMOTION_WEBHOOK_INVENTORY=https://yourstorename.com/api/smartstock/inventory  
INKANDEMOTION_WEBHOOK_ORDERS=https://yourstorename.com/api/smartstock/orders
```

### 3. Deploy Functions (2 minutes)
```bash
cd functions
firebase deploy --only functions
```

### Done! ✓
Your systems are now connected!

---

## 📋 What Happens Next

### When you ADD a product:
1. Enter product in SmartStock
2. Click Add Product
3. System automatically queues it for InkandEmotion
4. Check **Store Sync** → **Sync Queue Status** to track

### When inventory CHANGES:
1. Update quantity in SmartStock
2. Real-time sync automatically starts
3. InkandEmotion gets latest stock levels instantly

### When customer ORDERS on store:
1. Order hits InkandEmotion checkout
2. Automatically creates in SmartStock's Ecommerce Orders
3. Inventory auto-deducted
4. Order confirmation email sent

### When you UPDATE order status:
1. Change status in SmartStock (processing → shipped, etc)
2. Status automatically queues for sync
3. InkandEmotion receives update
4. Customer gets notified on store

---

## 🔍 Monitoring

### Check Sync Status
**Dashboard → Store Sync**

Shows real-time counts:
- ⏳ Products Pending
- 📦 Inventory Updates  
- 📋 Order Status Updates
- 🎯 Total Pending

All automatically process every few seconds!

---

## 🛠️ Common Tasks

### Sync All Existing Products
```
Store Sync → Sync Actions → "Sync All Products to Store"
```
Queues all products for InkandEmotion instantly.

### Test the Integration
1. Add a test product
2. Check if it appears on store within 30 seconds
3. Place test order on store
4. Verify it appears in **Ecommerce Orders** in SmartStock
5. Update order status → check store for update

### Fix Sync Issues
1. Go to **Store Sync** page
2. Check if **Connection Status** shows ✓ Connected
3. Verify all webhook URLs are correct
4. Check **Sync Queue Status** for pending items
5. Review Firebase Console for errors

---

## 📚 API Reference

### Quick API Calls

**Create Order (from store)**
```javascript
POST /createEcommerceOrder
{
  "items": [{"productId": "PROD-001", "quantity": 2}],
  "customer": {"name": "John", "email": "john@example.com"},
  "paymentStatus": "paid",
  "storeName": "inkandemotion.store"
}
```

**Check Sync Status**
```javascript
GET /getSyncStatus
```

---

## 📁 Files Modified/Created

**New Files:**
- `src/lib/inkandemotion-sync.js` - Sync service
- `src/Pages/Dashboard/StoreSync.jsx` - Configuration UI
- `INTEGRATION_GUIDE.md` - Full documentation

**Updated Files:**
- `src/App.js` - Added route for Store Sync
- `src/Pages/Dashboard/AddProduct.jsx` - Auto-sync on product creation
- `src/Components/DashboardLayout.jsx` - Added navigation link
- `functions/index.js` - Added sync queue processors

---

## ✅ Verification Checklist

After setup, verify:
- [ ] Store Sync page shows "Connected" status
- [ ] Add test product → Check store (should appear within 1 min)
- [ ] Update inventory → Monitor sync queue status
- [ ] Place test order on store → Check Ecommerce Orders
- [ ] Update order status → Monitor sync queue

---

## 🚨 Troubleshooting

| Issue | Solution |
|-------|----------|
| "Not Connected" | Fill store config and save |
| Products not syncing | Check webhook URL is correct |
| Orders not appearing | Verify product IDs match between systems |
| Sync stuck | Check Firebase console for errors |
| No webhook calls | Verify environment variables are set |

---

## 📞 Key Information

**Firebase Project ID**: `smartstock-ffa43`  
**Store Default Name**: `inkandemotion.store`  
**Checkout Collection**: `ecommerceOrders`  
**Sync Queues**: `productSyncQueue`, `inventorySyncQueue`, `orderStatusSyncQueue`

---

## 🎯 Next Steps

1. ✅ Complete 5-minute setup above
2. ✅ Test with sample products
3. ✅ Train your team on Store Sync page
4. ✅ Monitor sync queues for first week
5. ✅ Archive old orders after sync confirms
6. ✅ Set up automated backups

---

**Ready to go!** 🚀

Your SmartStock and InkandEmotion are now fully integrated.
Orders, products, and inventory sync automatically in real-time!
