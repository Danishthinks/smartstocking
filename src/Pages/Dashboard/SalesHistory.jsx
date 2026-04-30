import React, { useEffect, useMemo, useState } from 'react';
import DashboardLayout from '../../Components/DashboardLayout';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../lib/firebase';

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const asDate = (timestampValue) => (timestampValue?.toDate ? timestampValue.toDate() : null);

const normalizeItem = (item) => ({
  productName: item?.productName || 'Product',
  productId: item?.productId || item?.productDocId || '-',
  quantitySold: Number(item?.quantitySold ?? item?.quantity ?? 0),
  unitPrice: Number(item?.unitPrice ?? 0),
  salePrice: Number(item?.salePrice ?? 0)
});

const extractItems = (record) => {
  if (Array.isArray(record.items) && record.items.length > 0) {
    return record.items.map(normalizeItem);
  }

  // Backward compatibility for older single-item sale documents.
  return [
    {
      productName: record.productName || 'Product',
      productId: record.productId || record.productDocId || '-',
      quantitySold: Number(record.quantitySold || 0),
      unitPrice: Number(record.unitPrice || 0),
      salePrice: Number(record.salePrice || 0)
    }
  ];
};

const isEcommerceRecord = (record) => String(record.source || '').toLowerCase() === 'ecommerce';

const isRevenueEligible = (record) => {
  if (!isEcommerceRecord(record)) {
    return true;
  }

  const status = String(record.status || '').toLowerCase();
  const paymentStatus = String(record.paymentStatus || '').toLowerCase();
  return !['cancelled', 'canceled', 'refunded'].includes(status) && !['failed'].includes(paymentStatus);
};

const getRecordDate = (record) => asDate(record.timestamp) || asDate(record.createdAt);

export default function SalesHistory() {
  const [sales, setSales] = useState([]);
  const [onlineOrders, setOnlineOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [productFilter, setProductFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    const salesQuery = query(collection(db, 'sales'), orderBy('timestamp', 'desc'), limit(300));
    const ordersQuery = query(collection(db, 'ecommerceOrders'), orderBy('createdAt', 'desc'), limit(300));

    const unsubscribeSales = onSnapshot(
      salesQuery,
      (snapshot) => {
        const records = [];
        snapshot.forEach((saleDoc) => {
          records.push({ id: saleDoc.id, ...saleDoc.data() });
        });
        setSales(records);
      },
      (error) => {
        console.error('Error loading sales history:', error);
      }
    );

    const unsubscribeOrders = onSnapshot(
      ordersQuery,
      (snapshot) => {
        const records = [];
        snapshot.forEach((orderDoc) => {
          const data = orderDoc.data();
          records.push({
            id: orderDoc.id,
            ...data,
            source: 'ecommerce',
              storeName: data.storeName || data.integrationLabel || data.sourceUrl || 'inkandemotion.store',
            timestamp: data.createdAt || data.timestamp || null,
            orderId: data.orderId || orderDoc.id,
            salePrice: Number(data.grandTotal ?? data.salePrice ?? 0),
            soldByEmail: data.customer?.email || data.soldByEmail || '--',
            soldBy: data.customer?.name || data.soldBy || 'Storefront',
            status: data.status || 'processing',
            paymentStatus: data.paymentStatus || 'paid'
          });
        });
        setOnlineOrders(records);
        setLoading(false);
      },
      (error) => {
        console.error('Error loading ecommerce orders:', error);
        setLoading(false);
      }
    );

    return () => {
      unsubscribeSales();
      unsubscribeOrders();
    };
  }, []);

  const allRecords = useMemo(() => {
    return [...sales, ...onlineOrders].sort((left, right) => {
      const leftDate = getRecordDate(left)?.getTime?.() || 0;
      const rightDate = getRecordDate(right)?.getTime?.() || 0;
      return rightDate - leftDate;
    });
  }, [sales, onlineOrders]);

  const filteredSales = useMemo(() => {
    const productKeyword = productFilter.trim().toLowerCase();

    const startBoundary = startDate ? new Date(`${startDate}T00:00:00`) : null;
    const endBoundary = endDate ? new Date(`${endDate}T23:59:59.999`) : null;

    return allRecords.filter((sale) => {
      const saleDate = getRecordDate(sale);
      if (!saleDate) return false;

      if (startBoundary && saleDate < startBoundary) {
        return false;
      }

      if (endBoundary && saleDate > endBoundary) {
        return false;
      }

      if (!productKeyword) {
        return true;
      }

      const items = extractItems(sale);
      return items.some((item) => {
        const text = `${sale.orderId || ''} ${item.productName || ''} ${item.productId || ''}`.toLowerCase();
        return text.includes(productKeyword);
      });
    });
  }, [allRecords, productFilter, startDate, endDate]);

  const summary = useMemo(() => {
    return filteredSales.reduce(
      (acc, sale) => {
        const items = extractItems(sale);
        const saleTotal = Number(sale.salePrice || items.reduce((sum, item) => sum + Number(item.salePrice || 0), 0));
        const quantityTotal = items.reduce((sum, item) => sum + Number(item.quantitySold || 0), 0);
        const revenueEligible = isRevenueEligible(sale);

        return {
          totalSalesAmount: acc.totalSalesAmount + (revenueEligible ? saleTotal : 0),
          totalTransactions: acc.totalTransactions + 1,
          totalUnitsSold: acc.totalUnitsSold + quantityTotal,
          ecommerceOrders: acc.ecommerceOrders + (isEcommerceRecord(sale) ? 1 : 0)
        };
      },
      {
        totalSalesAmount: 0,
        totalTransactions: 0,
        totalUnitsSold: 0,
        ecommerceOrders: 0
      }
    );
  }, [filteredSales]);

  return (
    <DashboardLayout>
      <div style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-dark)', marginBottom: '20px' }}>
        Sales History
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px',
          marginBottom: '16px'
        }}
      >
        <div style={{ background: 'var(--card)', padding: '14px', borderRadius: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Total Sales</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-dark)' }}>
            {formatCurrency(summary.totalSalesAmount)}
          </div>
        </div>
        <div style={{ background: 'var(--card)', padding: '14px', borderRadius: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Transactions</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-dark)' }}>{summary.totalTransactions}</div>
        </div>
        <div style={{ background: 'var(--card)', padding: '14px', borderRadius: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Units Sold</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-dark)' }}>{summary.totalUnitsSold}</div>
        </div>
        <div style={{ background: 'var(--card)', padding: '14px', borderRadius: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Online Orders</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-dark)' }}>{summary.ecommerceOrders}</div>
        </div>
      </div>

      <div style={{ marginBottom: '14px', fontSize: '12px', color: '#64748b' }}>
        Ecommerce orders are included here; cancelled orders are excluded from revenue totals.
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr',
          gap: '10px',
          marginBottom: '16px'
        }}
      >
        <input
          type="text"
          value={productFilter}
          onChange={(event) => setProductFilter(event.target.value)}
          placeholder="Filter by product name or product ID"
          style={{
            padding: '10px',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            background: 'var(--card)',
            color: 'var(--text-dark)'
          }}
        />
        <input
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          style={{
            padding: '10px',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            background: 'var(--card)',
            color: 'var(--text-dark)'
          }}
        />
        <input
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          style={{
            padding: '10px',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            background: 'var(--card)',
            color: 'var(--text-dark)'
          }}
        />
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
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>Date</th>
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>Reference / Products</th>
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>Quantity</th>
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>Total</th>
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>Party</th>
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>Source / Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="6" style={{ padding: '18px', textAlign: 'center', color: '#64748b' }}>
                  Loading sales history...
                </td>
              </tr>
            ) : filteredSales.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ padding: '18px', textAlign: 'center', color: '#64748b' }}>
                  No sales found for the selected filters.
                </td>
              </tr>
            ) : (
              filteredSales.map((sale) => {
                const items = extractItems(sale);
                const saleDate = getRecordDate(sale);
                const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantitySold || 0), 0);
                const saleTotal = Number(sale.salePrice || items.reduce((sum, item) => sum + Number(item.salePrice || 0), 0));
                const isEcommerce = isEcommerceRecord(sale);
                const status = String(sale.status || (isEcommerce ? 'processing' : 'completed')).toLowerCase();
                const statusColor =
                  status === 'confirmed' || status === 'completed' || status === 'fulfilled'
                    ? '#166534'
                    : status === 'cancelled'
                    ? '#b91c1c'
                    : status === 'shipped'
                    ? '#7c3aed'
                    : '#92400e';
                const statusBg =
                  status === 'confirmed' || status === 'completed' || status === 'fulfilled'
                    ? '#dcfce7'
                    : status === 'cancelled'
                    ? '#fee2e2'
                    : status === 'shipped'
                    ? '#ede9fe'
                    : '#fef3c7';

                return (
                  <tr key={sale.id}>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>
                      {saleDate ? saleDate.toLocaleString() : '--'}
                    </td>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>
                      <div style={{ fontWeight: 600, marginBottom: '2px' }}>{sale.orderId || sale.id}</div>
                      {items.slice(0, 3).map((item, index) => (
                        <div key={`${sale.id}-item-${index}`} style={{ marginBottom: '2px' }}>
                          {item.productName || '-'} ({item.productId || '-'}) x{Number(item.quantitySold || 0)}
                        </div>
                      ))}
                      {items.length > 3 && (
                        <div style={{ color: '#64748b' }}>+{items.length - 3} more item(s)</div>
                      )}
                    </td>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>{totalQuantity}</td>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', fontSize: '13px', fontWeight: 600 }}>
                      {formatCurrency(saleTotal)}
                    </td>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>
                      <div style={{ fontWeight: 600 }}>{sale.soldBy || sale.customer?.name || '--'}</div>
                      <div style={{ color: '#64748b' }}>{sale.soldByEmail || sale.customer?.email || '--'}</div>
                      {isEcommerce && (
                        <div style={{ color: '#64748b', marginTop: '2px' }}>
                          {sale.storeName || 'inkandemotion.store'}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>
                      <div style={{ marginBottom: '6px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '4px 8px',
                            borderRadius: '999px',
                            fontSize: '12px',
                            fontWeight: 700,
                            background: isEcommerce ? '#dbeafe' : '#e2e8f0',
                            color: isEcommerce ? '#1d4ed8' : '#334155'
                          }}
                        >
                          {isEcommerce ? 'Ecommerce' : 'POS'}
                        </span>
                      </div>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '4px 8px',
                          borderRadius: '999px',
                          fontSize: '12px',
                          fontWeight: 700,
                          background: statusBg,
                          color: statusColor
                        }}
                      >
                        {status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </DashboardLayout>
  );
}
