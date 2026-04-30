/**
 * InkandEmotion Sync Service
 * Synchronizes products, inventory, and orders between SmartStock and InkandEmotion
 */

import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  setDoc, 
  updateDoc, 
  doc, 
  getDocs,
  serverTimestamp,
  addDoc
} from 'firebase/firestore';
import { db, functions } from './firebase';
import { httpsCallable } from 'firebase/functions';

const STORE_NAME = 'inkandemotion.store';
const SYNC_COLLECTION = 'storeSyncConfig';

/**
 * Configure store connection settings
 */
export const configureStoreConnection = async (storeConfig) => {
  try {
    const configRef = doc(db, SYNC_COLLECTION, 'config');
    await setDoc(configRef, {
      ...storeConfig,
      storeName: STORE_NAME,
      lastSyncAt: serverTimestamp(),
      status: 'connected'
    }, { merge: true });
    
    console.log('Store connection configured:', storeConfig);
    return { success: true, message: 'Store connected successfully' };
  } catch (error) {
    console.error('Error configuring store:', error);
    throw error;
  }
};

/**
 * Get store connection status
 */
export const getStoreConnectionStatus = async () => {
  try {
    const configRef = doc(db, SYNC_COLLECTION, 'config');
    const snapshot = await getDocs(query(collection(db, SYNC_COLLECTION)));
    
    if (snapshot.empty) {
      return { connected: false, storeName: null };
    }

    const config = snapshot.docs[0].data();
    return { 
      connected: config.status === 'connected',
      storeName: config.storeName,
      lastSyncAt: config.lastSyncAt?.toDate?.()
    };
  } catch (error) {
    console.error('Error getting store status:', error);
    return { connected: false, storeName: null };
  }
};

/**
 * Sync product to InkandEmotion
 * Sends product data to be created/updated on the store
 */
export const syncProductToStore = async (productData) => {
  try {
    // Store product sync record for webhook or API to pick up
    const syncRef = collection(db, 'productSyncQueue');
    
    const syncData = {
      productId: productData.productId,
      name: productData.name,
      category: productData.category,
      sellingPrice: productData.sellingPrice,
      purchasePrice: productData.purchasePrice,
      quantity: productData.quantity,
      barcode: productData.barcode,
      vendorName: productData.vendorName,
      warehouse: productData.warehouse,
      storeName: STORE_NAME,
      status: 'pending',
      action: 'create',
      createdAt: serverTimestamp(),
      syncedAt: null,
      error: null
    };

    const docRef = await addDoc(syncRef, syncData);
    console.log('Product queued for sync:', productData.productId);
    
    return { success: true, syncId: docRef.id };
  } catch (error) {
    console.error('Error syncing product:', error);
    throw error;
  }
};

/**
 * Sync inventory updates to InkandEmotion
 * Called whenever stock changes in SmartStock
 */
export const syncInventoryUpdate = async (productId, newQuantity, warehouse) => {
  try {
    const inventoryRef = collection(db, 'inventorySyncQueue');
    
    const syncData = {
      productId,
      warehouse,
      quantity: newQuantity,
      storeName: STORE_NAME,
      timestamp: serverTimestamp(),
      status: 'pending',
      syncedAt: null
    };

    const docRef = await addDoc(inventoryRef, syncData);
    console.log('Inventory update queued:', productId, newQuantity);
    
    return { success: true, syncId: docRef.id };
  } catch (error) {
    console.error('Error syncing inventory:', error);
    throw error;
  }
};

/**
 * Listen to order status changes and sync back to InkandEmotion
 */
export const listenToOrderStatusChanges = (callback) => {
  try {
    const ordersQuery = query(
      collection(db, 'ecommerceOrders'),
      where('storeName', '==', STORE_NAME)
    );

    const unsubscribe = onSnapshot(ordersQuery, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'modified') {
          const orderData = change.doc.data();
          
          // Queue order status update to InkandEmotion
          queueOrderStatusUpdate({
            orderId: orderData.orderId,
            externalOrderId: orderData.externalOrderId,
            status: orderData.status,
            paymentStatus: orderData.paymentStatus,
            lastUpdatedAt: serverTimestamp()
          });

          if (callback) {
            callback({
              type: 'orderStatusChanged',
              order: {
                id: change.doc.id,
                ...orderData
              }
            });
          }
        }
      });
    });

    return unsubscribe;
  } catch (error) {
    console.error('Error listening to order changes:', error);
    return null;
  }
};

/**
 * Queue order status update for InkandEmotion webhook
 */
const queueOrderStatusUpdate = async (orderStatusData) => {
  try {
    const queueRef = collection(db, 'orderStatusSyncQueue');
    
    await addDoc(queueRef, {
      ...orderStatusData,
      storeName: STORE_NAME,
      status: 'pending',
      createdAt: serverTimestamp(),
      syncedAt: null,
      retryCount: 0
    });

    console.log('Order status update queued:', orderStatusData.orderId);
  } catch (error) {
    console.error('Error queueing order status update:', error);
  }
};

/**
 * Sync product inventory after checkout
 * Automatically called when order is created
 */
export const deductInventoryAfterCheckout = async (items) => {
  try {
    const deductionRecords = [];

    for (const item of items) {
      // Queue inventory deduction
      await syncInventoryUpdate(
        item.productId || item.productDocId,
        item.remainingStock,
        item.warehouse
      );

      deductionRecords.push({
        productId: item.productId,
        quantityDeducted: item.quantity,
        remainingStock: item.remainingStock
      });
    }

    console.log('Inventory deductions queued:', deductionRecords);
    return { success: true, records: deductionRecords };
  } catch (error) {
    console.error('Error deducting inventory:', error);
    throw error;
  }
};

/**
 * Get all products synced to store
 */
export const getSyncedProducts = async () => {
  try {
    const productsQuery = query(
      collection(db, 'products'),
      where('storeName', '==', STORE_NAME)
    );

    const snapshot = await getDocs(productsQuery);
    const products = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return products;
  } catch (error) {
    console.error('Error getting synced products:', error);
    return [];
  }
};

/**
 * Get sync queue status for monitoring
 */
export const getSyncQueueStatus = async () => {
  try {
    const productSyncDocs = await getDocs(query(
      collection(db, 'productSyncQueue'),
      where('status', '==', 'pending')
    ));

    const inventorySyncDocs = await getDocs(query(
      collection(db, 'inventorySyncQueue'),
      where('status', '==', 'pending')
    ));

    const orderStatusSyncDocs = await getDocs(query(
      collection(db, 'orderStatusSyncQueue'),
      where('status', '==', 'pending')
    ));

    return {
      productSyncPending: productSyncDocs.size,
      inventorySyncPending: inventorySyncDocs.size,
      orderStatusSyncPending: orderStatusSyncDocs.size,
      totalPending: productSyncDocs.size + inventorySyncDocs.size + orderStatusSyncDocs.size
    };
  } catch (error) {
    console.error('Error getting sync status:', error);
    return {
      productSyncPending: 0,
      inventorySyncPending: 0,
      orderStatusSyncPending: 0,
      totalPending: 0
    };
  }
};

/**
 * Manual trigger to sync all products to store
 */
export const syncAllProducts = async () => {
  try {
    const productsSnapshot = await getDocs(collection(db, 'products'));
    let syncedCount = 0;

    for (const productDoc of productsSnapshot.docs) {
      const product = productDoc.data();
      await syncProductToStore(product);
      syncedCount++;
    }

    console.log(`Synced ${syncedCount} products to store`);
    return { success: true, syncedCount };
  } catch (error) {
    console.error('Error syncing all products:', error);
    throw error;
  }
};

/**
 * Handle incoming order from InkandEmotion checkout
 * This creates order in SmartStock inventory system
 */
export const handleIncomingCheckout = async (checkoutData) => {
  try {
    // Call Firebase function to create ecommerce order using modular API
    const createOrderFunction = httpsCallable(functions, 'createEcommerceOrder');
    const response = await createOrderFunction({
      ...checkoutData,
      storeName: STORE_NAME,
      source: 'inkandemotion.store',
      recordSale: true
    });

    // httpsCallable returns an object with a `data` property
    const result = response?.data ?? response;
    console.log('Checkout processed:', result);
    return result;
  } catch (error) {
    console.error('Error processing checkout:', error);
    throw error;
  }
};

export default {
  configureStoreConnection,
  getStoreConnectionStatus,
  syncProductToStore,
  syncInventoryUpdate,
  listenToOrderStatusChanges,
  getSyncedProducts,
  getSyncQueueStatus,
  syncAllProducts,
  handleIncomingCheckout,
  deductInventoryAfterCheckout
};
