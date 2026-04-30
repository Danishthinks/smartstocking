import React, { useEffect, useMemo, useState } from 'react';
import DashboardLayout from '../../Components/DashboardLayout';
import { collection, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const asDate = (value) => (value?.toDate ? value.toDate() : null);

const orderStatuses = ['all', 'processing', 'confirmed', 'shipped', 'fulfilled', 'cancelled'];
const defaultStoreName = 'inkandemotion.store';

const statusStyle = (status) => {
  const normalized = String(status || '').toLowerCase();

  if (normalized === 'confirmed') {
    return { background: '#dbeafe', color: '#1d4ed8' };
  }

  if (normalized === 'shipped') {
    return { background: '#ede9fe', color: '#7c3aed' };
  }

  if (normalized === 'fulfilled') {
    return { background: '#dcfce7', color: '#166534' };
  }

  if (normalized === 'cancelled') {
    return { background: '#fee2e2', color: '#b91c1c' };
  }

  return { background: '#fef3c7', color: '#92400e' };
};

const normalizeOrder = (docSnap) => {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    ...data,
    createdAt: data.createdAt || data.timestamp || null,
    totalAmount: Number(data.grandTotal ?? data.salePrice ?? 0),
    totalQuantity: Number(data.totalQuantity ?? data.items?.reduce((sum, item) => sum + Number(item.quantity || item.quantitySold || 0), 0) ?? 0)
  };
};

export default function EcommerceOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [message, setMessage] = useState({ text: '', type: '' });
  const [updatingId, setUpdatingId] = useState('');

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    const ordersQuery = query(collection(db, 'ecommerceOrders'), orderBy('createdAt', 'desc'), limit(250));
    const unsubscribe = onSnapshot(
      ordersQuery,
      (snapshot) => {
        const records = [];
        snapshot.forEach((orderDoc) => records.push(normalizeOrder(orderDoc)));
        setOrders(records);
        setLoading(false);
      },
      (error) => {
        console.error('Error loading ecommerce orders:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const showMessage = (text, type = 'info') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 4000);
  };

  const filteredOrders = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();

    return orders.filter((order) => {
      if (statusFilter !== 'all' && String(order.status || '').toLowerCase() !== statusFilter) {
        return false;
      }

      if (!keyword) return true;

      const text = [
        order.orderId,
        order.customer?.name,
        order.customer?.email,
        order.customer?.phone,
        order.storeName,
        order.source,
        order.status,
        order.paymentStatus,
        ...(order.items || []).map((item) => `${item.productName || ''} ${item.productId || ''}`)
      ]
        .join(' ')
        .toLowerCase();

      return text.includes(keyword);
    });
  }, [orders, searchTerm, statusFilter]);

  const summary = useMemo(() => {
    return filteredOrders.reduce(
      (acc, order) => {
        const status = String(order.status || 'processing').toLowerCase();
        return {
          totalOrders: acc.totalOrders + 1,
          processing: acc.processing + (status === 'processing' ? 1 : 0),
          confirmed: acc.confirmed + (status === 'confirmed' ? 1 : 0),
          shipped: acc.shipped + (status === 'shipped' ? 1 : 0),
          fulfilled: acc.fulfilled + (status === 'fulfilled' ? 1 : 0),
          cancelled: acc.cancelled + (status === 'cancelled' ? 1 : 0),
          revenue:
            acc.revenue + (status === 'cancelled' ? 0 : Number(order.totalAmount || 0))
        };
      },
      {
        totalOrders: 0,
        processing: 0,
        confirmed: 0,
        shipped: 0,
        fulfilled: 0,
        cancelled: 0,
        revenue: 0
      }
    );
  }, [filteredOrders]);

  const connectedStore = useMemo(() => {
    const names = Array.from(
      new Set(
        orders.map((order) => order.storeName || order.sourceUrl || order.source).filter(Boolean)
      )
    );

    return names.length > 0 ? names : [defaultStoreName];
  }, [orders]);

  const handleUpdateStatus = async (orderId, nextStatus) => {
    if (!orderId || !nextStatus || !db) return;

    try {
      setUpdatingId(orderId);
      await updateDoc(doc(db, 'ecommerceOrders', orderId), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
        updatedBy: auth?.currentUser?.uid || null
      });
      showMessage(`Order ${orderId} updated to ${nextStatus}.`, nextStatus === 'cancelled' ? 'warning' : 'success');
    } catch (error) {
      console.error('Order status update failed:', error);
      showMessage(error.message || 'Could not update order status.', 'error');
    } finally {
      setUpdatingId('');
    }
  };

  return (
    <DashboardLayout>
      <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-dark)', marginBottom: '20px' }}>
        Ecommerce Orders
      </div>

      <div
        style={{
          background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)',
          border: '1px solid #bfdbfe',
          color: '#1d4ed8',
          padding: '12px 14px',
          borderRadius: '10px',
          marginBottom: '16px',
          fontSize: '13px',
          fontWeight: 600
        }}
      >
        Connected store: {connectedStore.join(', ')}
      </div>

      {message.text && (
        <div
          style={{
            backgroundColor: message.type === 'success' ? '#0a7b0015' : message.type === 'warning' ? '#9B870C15' : '#2563eb15',
            color: message.type === 'success' ? '#0a7b00' : message.type === 'warning' ? '#9B870C' : '#2563eb',
            padding: '10px 12px',
            borderRadius: '8px',
            marginBottom: '16px',
            border: `1px solid ${message.type === 'success' ? '#0a7b0030' : message.type === 'warning' ? '#9B870C30' : '#2563eb30'}`
          }}
        >
          {message.text}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px',
          marginBottom: '16px'
        }}
      >
        {[
          { label: 'Total Orders', value: summary.totalOrders },
          { label: 'Processing', value: summary.processing },
          { label: 'Confirmed', value: summary.confirmed },
          { label: 'Shipped', value: summary.shipped },
          { label: 'Fulfilled', value: summary.fulfilled },
          { label: 'Cancelled', value: summary.cancelled },
          { label: 'Revenue', value: formatCurrency(summary.revenue) }
        ].map((card) => (
          <div key={card.label} style={{ background: 'var(--card)', padding: '14px', borderRadius: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>{card.label}</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-dark)' }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: '10px',
          marginBottom: '16px'
        }}
      >
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search by order ID, customer, email, or product"
          style={{
            padding: '10px',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            background: 'var(--card)',
            color: 'var(--text-dark)'
          }}
        />
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          style={{
            padding: '10px',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            background: 'var(--card)',
            color: 'var(--text-dark)'
          }}
        >
          {orderStatuses.map((status) => (
            <option key={status} value={status}>
              {status === 'all' ? 'All Statuses' : status.charAt(0).toUpperCase() + status.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <div
        style={{
          backgroundColor: 'var(--card)',
          boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
          borderRadius: '10px',
          overflow: 'hidden'
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#eef2ff' }}>
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>Order</th>
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>Date</th>
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>Customer</th>
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>Store</th>
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>Items</th>
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>Total</th>
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>Payment</th>
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>Status</th>
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="9" style={{ padding: '18px', textAlign: 'center', color: '#64748b' }}>
                  Loading ecommerce orders...
                </td>
              </tr>
            ) : filteredOrders.length === 0 ? (
              <tr>
                <td colSpan="9" style={{ padding: '18px', textAlign: 'center', color: '#64748b' }}>
                  No ecommerce orders found for the selected filters.
                </td>
              </tr>
            ) : (
              filteredOrders.map((order) => {
                const orderDate = asDate(order.createdAt);
                const items = Array.isArray(order.items) ? order.items : [];
                const status = String(order.status || 'processing').toLowerCase();
                const isUpdating = updatingId === order.id;

                return (
                  <tr key={order.id}>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', fontSize: '13px', fontWeight: 600 }}>
                      {order.orderId || order.id}
                    </td>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>
                      {orderDate ? orderDate.toLocaleString() : '--'}
                    </td>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>
                      <div style={{ fontWeight: 600 }}>{order.customer?.name || '--'}</div>
                      <div style={{ color: '#64748b' }}>{order.customer?.email || '--'}</div>
                    </td>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>
                      <div style={{ fontWeight: 600 }}>{order.storeName || defaultStoreName}</div>
                      <div style={{ color: '#64748b' }}>{order.source || order.sourceUrl || defaultStoreName}</div>
                    </td>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>
                      {items.slice(0, 2).map((item, index) => (
                        <div key={`${order.id}-item-${index}`} style={{ marginBottom: '2px' }}>
                          {item.productName || '-'} x{Number(item.quantity || item.quantitySold || 0)}
                        </div>
                      ))}
                      {items.length > 2 && <div style={{ color: '#64748b' }}>+{items.length - 2} more item(s)</div>}
                    </td>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', fontSize: '13px', fontWeight: 600 }}>
                      {formatCurrency(order.totalAmount)}
                    </td>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>
                      <div>{String(order.paymentMethod || 'online').toUpperCase()}</div>
                      <div style={{ color: '#64748b' }}>{String(order.paymentStatus || 'paid')}</div>
                    </td>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '4px 8px',
                          borderRadius: '999px',
                          fontSize: '12px',
                          fontWeight: 700,
                          ...statusStyle(status)
                        }}
                      >
                        {status}
                      </span>
                    </td>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {['confirmed', 'shipped', 'fulfilled', 'cancelled'].map((nextStatus) => (
                          <button
                            key={nextStatus}
                            onClick={() => handleUpdateStatus(order.id, nextStatus)}
                            disabled={isUpdating || status === nextStatus}
                            style={{
                              padding: '6px 10px',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '12px',
                              cursor: isUpdating || status === nextStatus ? 'not-allowed' : 'pointer',
                              background: nextStatus === 'cancelled' ? '#ef4444' : nextStatus === 'fulfilled' ? '#16a34a' : '#2563eb',
                              color: '#fff',
                              opacity: isUpdating || status === nextStatus ? 0.7 : 1
                            }}
                          >
                            {nextStatus}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '10px', fontSize: '12px', color: '#64748b' }}>
        Cancelling an order restores stock automatically through your backend sync pipeline.
      </div>
    </DashboardLayout>
  );
}