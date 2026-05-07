import React, { useState, useEffect } from 'react';
import DashboardLayout from '../../Components/DashboardLayout';
import { collection, query, getDocs, addDoc, onSnapshot, orderBy, limit, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';

export default function StoreSync() {
  const [recentOrders, setRecentOrders] = useState([]);
  const [productCount, setProductCount] = useState(0);
  const [storeProductCount, setStoreProductCount] = useState(0);
  
  const [loading, setLoading] = useState(true);
  const [testOrderLoading, setTestOrderLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  useEffect(() => {
    loadData();
    
    // Real-time listener for recent orders from store
    const q = query(
      collection(db, 'ecommerceOrders'),
      orderBy('createdAt', 'desc'),
      limit(10)
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const orders = [];
      snapshot.forEach((doc) => {
        orders.push({ id: doc.id, ...doc.data() });
      });
      setRecentOrders(orders);
    }, (error) => {
      console.error('Error listening to orders:', error);
    });

    return () => unsubscribe();
  }, []);

  const loadData = async () => {
    try {
      // Count total products in SmartStock
      const smartstockProducts = await getDocs(
        query(collection(db, 'products'), where('source', '==', 'smartstock'))
      );
      setProductCount(smartstockProducts.size);

      // Count products available on store
      const storeProducts = await getDocs(
        query(collection(db, 'products'), where('showOnStore', '==', true))
      );
      setStoreProductCount(storeProducts.size);

      setLoading(false);
    } catch (error) {
      console.error('Error loading data:', error);
      setLoading(false);
    }
  };

  const handleCreateTestOrder = async () => {
    setTestOrderLoading(true);
    try {
      // Get some products to create test order items
      const productsSnapshot = await getDocs(
        query(collection(db, 'products'), where('showOnStore', '==', true), limit(3))
      );

      if (productsSnapshot.empty) {
        showMessage('⚠️ No products available to create test order. Add products first!', 'warning');
        setTestOrderLoading(false);
        return;
      }

      // Create test order items from available products
      const orderItems = productsSnapshot.docs.map((doc) => {
        const product = doc.data();
        return {
          productId: product.productId,
          name: product.name,
          price: product.sellingPrice,
          quantity: 1,
          total: product.sellingPrice
        };
      });

      const testOrder = {
        orderNumber: `TEST-${Date.now()}`,
        customerName: 'Test Customer',
        customerEmail: 'test@inkandemotion.store',
        customerPhone: '+92 300 1234567',
        deliveryAddress: 'Test Address, Karachi, Pakistan',
        items: orderItems,
        subtotal: orderItems.reduce((sum, item) => sum + item.total, 0),
        shippingCost: 0,
        tax: 0,
        totalAmount: orderItems.reduce((sum, item) => sum + item.total, 0),
        paymentMethod: 'Test Payment',
        paymentStatus: 'pending',
        orderStatus: 'pending',
        createdAt: new Date(),
        createdBy: 'storefront',
        source: 'inkandemotion.store',
        processed: false,
        inventoryApplied: false
      };

      const docRef = await addDoc(collection(db, 'ecommerceOrders'), testOrder);
      
      showMessage(
        `✅ Test order created! Order ID: ${docRef.id}. Check the ecommerce page to see it.`,
        'success'
      );
      
      setTimeout(() => loadData(), 500);
    } catch (error) {
      console.error('Error creating test order:', error);
      showMessage('❌ Error: ' + error.message, 'error');
    } finally {
      setTestOrderLoading(false);
    }
  };

  const showMessage = (text, type = 'info') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 5000);
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px' }}>
          <div style={{ color: '#64748b' }}>Loading store data...</div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '30px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-dark)', marginBottom: '8px' }}>
            🎨 InkandEmotion Store Sync
          </h1>
          <p style={{ fontSize: '14px', color: '#64748b' }}>
            Shared Firestore Database • Manage store integration and test orders
          </p>
        </div>

        {/* Message Alert */}
        {message.text && (
          <div
            style={{
              marginBottom: '20px',
              padding: '12px 16px',
              borderRadius: '6px',
              backgroundColor:
                message.type === 'error'
                  ? '#fee2e2'
                  : message.type === 'success'
                    ? '#dcfce7'
                    : '#fef08a',
              color:
                message.type === 'error'
                  ? '#991b1b'
                  : message.type === 'success'
                    ? '#166534'
                    : '#92400e',
              fontSize: '13px',
              fontWeight: 600,
              border: `1px solid ${
                message.type === 'error'
                  ? '#fca5a5'
                  : message.type === 'success'
                    ? '#86efac'
                    : '#fde047'
              }`
            }}
          >
            {message.text}
          </div>
        )}

        {/* Connection Status Card */}
        <div
          style={{
            backgroundColor: 'var(--card)',
            padding: '20px',
            borderRadius: '12px',
            boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
            marginBottom: '20px',
            borderLeft: '4px solid #10b981'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-dark)', marginBottom: '8px' }}>
                ✅ Connection Status
              </h2>
              <p style={{ fontSize: '14px', color: '#64748b' }}>
                <strong>Store:</strong> inkandemotion.store
              </p>
              <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                <strong>Database:</strong> Shared Firestore
              </p>
              <p style={{ fontSize: '14px', color: '#10b981', fontWeight: 600, marginTop: '4px' }}>
                ● Connected & Ready
              </p>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px', marginBottom: '20px' }}>
          <div
            style={{
              backgroundColor: 'var(--card)',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
              borderTop: '3px solid #3b82f6'
            }}
          >
            <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', fontWeight: 600 }}>
              SmartStock Products
            </p>
            <p style={{ fontSize: '28px', fontWeight: 700, color: '#3b82f6' }}>{productCount}</p>
            <p style={{ fontSize: '12px', color: '#64748b', marginTop: '8px' }}>Total in inventory</p>
          </div>

          <div
            style={{
              backgroundColor: 'var(--card)',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
              borderTop: '3px solid #8b5cf6'
            }}
          >
            <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', fontWeight: 600 }}>
              Store Catalog
            </p>
            <p style={{ fontSize: '28px', fontWeight: 700, color: '#8b5cf6' }}>{storeProductCount}</p>
            <p style={{ fontSize: '12px', color: '#64748b', marginTop: '8px' }}>Visible on store</p>
          </div>

          <div
            style={{
              backgroundColor: 'var(--card)',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
              borderTop: '3px solid #ef4444'
            }}
          >
            <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', fontWeight: 600 }}>
              Recent Orders
            </p>
            <p style={{ fontSize: '28px', fontWeight: 700, color: '#ef4444' }}>{recentOrders.length}</p>
            <p style={{ fontSize: '12px', color: '#64748b', marginTop: '8px' }}>Latest from store</p>
          </div>
        </div>

        {/* Test Order Section */}
        <div
          style={{
            backgroundColor: 'var(--card)',
            padding: '20px',
            borderRadius: '12px',
            boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
            marginBottom: '20px'
          }}
        >
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-dark)', marginBottom: '12px' }}>
            🧪 Test Order Generator
          </h2>
          <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>
            Create a test order to verify the order flow. It will appear instantly in the ecommerce page.
          </p>
          <button
            onClick={handleCreateTestOrder}
            disabled={testOrderLoading || storeProductCount === 0}
            style={{
              padding: '10px 20px',
              borderRadius: '6px',
              border: 'none',
              background: storeProductCount === 0 ? '#cbd5e1' : 'linear-gradient(135deg, #f59e0b, #f97316)',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: storeProductCount === 0 ? 'not-allowed' : 'pointer',
              opacity: testOrderLoading ? 0.7 : 1,
              transition: 'all 0.2s'
            }}
          >
            {testOrderLoading ? '⏳ Creating Test Order...' : '➕ Generate Test Order'}
          </button>
          {storeProductCount === 0 && (
            <p style={{ fontSize: '12px', color: '#ef4444', marginTop: '8px', fontWeight: 600 }}>
              ⚠️ Add products to store first (set showOnStore = true)
            </p>
          )}
        </div>

        {/* Recent Orders */}
        <div
          style={{
            backgroundColor: 'var(--card)',
            padding: '20px',
            borderRadius: '12px',
            boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
            marginBottom: '20px'
          }}
        >
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-dark)', marginBottom: '16px' }}>
            📋 Recent Store Orders
          </h2>

          {recentOrders.length === 0 ? (
            <p style={{ fontSize: '13px', color: '#64748b', padding: '20px', textAlign: 'center' }}>
              No orders yet. Click "Generate Test Order" to create one!
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '13px'
                }}
              >
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>Order ID</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>Customer</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>Items</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>Total</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>Status</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => (
                    <tr key={order.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '12px', color: 'var(--text-dark)', fontWeight: 600 }}>
                        {order.orderNumber || order.orderId || order.id.substring(0, 8)}
                      </td>
                      <td style={{ padding: '12px', color: 'var(--text-dark)' }}>
                        <div style={{ fontWeight: 600 }}>
                          {order.customer?.name || order.customerName || '--'}
                        </div>
                        <div style={{ color: '#64748b', fontSize: '12px' }}>
                          {order.customer?.email || order.customerEmail || '--'}
                        </div>
                      </td>
                      <td style={{ padding: '12px', color: 'var(--text-dark)' }}>
                        {(Array.isArray(order.items) ? order.items : []).slice(0, 2).map((item, index) => (
                          <div key={`${order.id}-item-${index}`} style={{ marginBottom: '2px' }}>
                            {item.productName || item.name || '-'} x{Number(item.quantity || item.quantitySold || 0)}
                          </div>
                        ))}
                        {Array.isArray(order.items) && order.items.length > 2 && (
                          <div style={{ color: '#64748b' }}>+{order.items.length - 2} more item(s)</div>
                        )}
                      </td>
                      <td style={{ padding: '12px', color: 'var(--text-dark)', fontWeight: 600 }}>
                        Rs. {(Number(order.totalAmount ?? order.grandTotal ?? order.salePrice ?? 0)).toLocaleString()}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            backgroundColor:
                              order.orderStatus === 'completed'
                                ? '#dcfce7'
                                : order.orderStatus === 'shipped'
                                  ? '#dbeafe'
                                  : '#fef08a',
                            color:
                              order.orderStatus === 'completed'
                                ? '#166534'
                                : order.orderStatus === 'shipped'
                                  ? '#0c4a6e'
                                  : '#92400e'
                          }}
                        >
                          {order.orderStatus || 'pending'}
                        </span>
                      </td>
                      <td style={{ padding: '12px', color: '#64748b', fontSize: '12px' }}>
                        {order.createdAt?.toDate?.().toLocaleDateString?.() ||
                          (typeof order.createdAt === 'number' 
                            ? new Date(order.createdAt).toLocaleDateString()
                            : new Date().toLocaleDateString())}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Info Section */}
        <div style={{
          backgroundColor: '#dbeafe',
          border: '1px solid #7dd3fc',
          borderRadius: '6px',
          padding: '16px',
          marginTop: '20px'
        }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#0c4a6e', marginBottom: '8px' }}>How it works</h3>
          <ul style={{ fontSize: '13px', color: '#0c4a6e', lineHeight: '1.6' }}>
            <li>✓ <strong>Products:</strong> Add products in SmartStock, they sync automatically to InkandEmotion</li>
            <li>✓ <strong>Inventory:</strong> Stock changes are synced in real-time</li>
            <li>✓ <strong>Orders:</strong> Orders created here or on the storefront appear instantly</li>
            <li>✓ <strong>Auto Deduction:</strong> When orders are processed, inventory is automatically deducted</li>
          </ul>
        </div>
      </div>
    </DashboardLayout>
  );
}
