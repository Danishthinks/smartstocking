import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DashboardLayout from '../../Components/DashboardLayout';
import { auth, db } from '../../lib/firebase';
import { addLog } from '../../lib/firebase-logs';
import { pushNotification, sendCrudNotification } from '../../lib/notifications';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp
} from 'firebase/firestore';

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const round2 = (num) => Math.round(Number(num || 0) * 100) / 100;
const SCANNER_ELEMENT_ID = 'smartstock-barcode-scanner';
const BARCODE_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.PDF_417,
  Html5QrcodeSupportedFormats.AZTEC
];

export default function POS() {
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [cartItems, setCartItems] = useState([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [isScannerStarting, setIsScannerStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [message, setMessage] = useState({ text: '', type: '' });
  const scannerRef = useRef(null);
  const scannerStartingRef = useRef(false);
  const lastScanRef = useRef({ value: '', at: 0 });

  useEffect(() => {
    if (!db) {
      setLoadingProducts(false);
      return;
    }

    const productsQuery = query(collection(db, 'products'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(
      productsQuery,
      (snapshot) => {
        const productData = [];
        snapshot.forEach((productDoc) => {
          const data = productDoc.data();
          productData.push({
            id: productDoc.id,
            ...data
          });
        });
        setProducts(productData);
        setLoadingProducts(false);
      },
      (error) => {
        console.error('Error loading products for POS:', error);
        setLoadingProducts(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const showMessage = (text, type = 'warning') => {
    setMessage({ text, type });
    setTimeout(() => {
      setMessage({ text: '', type: '' });
    }, 5000);
  };

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) || null,
    [products, selectedProductId]
  );

  const quantityNumber = Number.parseInt(quantity, 10) || 0;
  const availableQuantity = Number(selectedProduct?.quantity || 0);
  const unitPrice = round2(selectedProduct?.sellingPrice || 0);
  const totalPrice = round2(quantityNumber * unitPrice);

  const cartTotal = useMemo(
    () => round2(cartItems.reduce((sum, item) => sum + Number(item.salePrice || 0), 0)),
    [cartItems]
  );

  const totalCartQty = useMemo(
    () => cartItems.reduce((sum, item) => sum + Number(item.quantitySold || 0), 0),
    [cartItems]
  );

  const getCartQtyForProduct = useCallback(
    (productDocId) => {
      const item = cartItems.find((cartItem) => cartItem.productDocId === productDocId);
      return Number(item?.quantitySold || 0);
    },
    [cartItems]
  );

  const findProductByBarcodeValue = useCallback(
    (barcodeValue) => {
      const normalized = String(barcodeValue || '').trim();
      if (!normalized) return null;

      return (
        products.find((product) => String(product.barcode || '').trim() === normalized) ||
        products.find((product) => String(product.productId || '').trim() === normalized) ||
        products.find((product) => String(product.id || '').trim() === normalized)
      );
    },
    [products]
  );

  const addProductToCart = useCallback(
    (product, qtyToAdd) => {
      const parsedQty = Number(qtyToAdd || 0);
      if (!product) {
        return false;
      }

      if (!Number.isInteger(parsedQty) || parsedQty <= 0) {
        showMessage('Please enter a valid quantity to sell.', 'warning');
        return false;
      }

      const availableStock = Number(product.quantity || 0);
      const currentCartQty = getCartQtyForProduct(product.id);
      if (parsedQty + currentCartQty > availableStock) {
        showMessage(
          `Not enough stock for ${product.name || 'product'}. Available: ${availableStock}, in cart: ${currentCartQty}.`,
          'warning'
        );
        return false;
      }

      const unitPriceForItem = round2(product.sellingPrice || 0);
      const newItem = {
        productDocId: product.id,
        productId: product.productId || product.id,
        productName: product.name || 'Product',
        quantitySold: parsedQty,
        unitPrice: unitPriceForItem,
        salePrice: round2(parsedQty * unitPriceForItem)
      };

      setCartItems((previous) => {
        const existingIndex = previous.findIndex((item) => item.productDocId === newItem.productDocId);
        if (existingIndex === -1) {
          return [...previous, newItem];
        }

        const next = [...previous];
        const existing = next[existingIndex];
        const mergedQty = Number(existing.quantitySold || 0) + newItem.quantitySold;
        next[existingIndex] = {
          ...existing,
          quantitySold: mergedQty,
          salePrice: round2(mergedQty * Number(existing.unitPrice || unitPriceForItem))
        };
        return next;
      });

      return true;
    },
    [getCartQtyForProduct]
  );

  const handleAddToCart = () => {
    if (!selectedProduct) {
      showMessage('Please select a product first.', 'warning');
      return;
    }

    const added = addProductToCart(selectedProduct, quantityNumber);
    if (!added) return;

    setQuantity('');
    showMessage('Item added to cart.', 'success');
  };

  const handleRemoveFromCart = (productDocId) => {
    setCartItems((previous) => previous.filter((item) => item.productDocId !== productDocId));
  };

  useEffect(() => {
    const stopScanner = async () => {
      if (!scannerRef.current) return;
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
      } catch (error) {
        console.error('Failed to stop barcode scanner:', error);
      } finally {
        try {
          await scannerRef.current.clear();
        } catch (error) {
          console.error('Failed to clear barcode scanner:', error);
        }
        scannerRef.current = null;
      }
    };

    const startScanner = async () => {
      if (!scannerOpen) {
        await stopScanner();
        return;
      }

      if (scannerRef.current || scannerStartingRef.current) {
        return;
      }

      scannerStartingRef.current = true;
      setIsScannerStarting(true);
      try {
        const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 300, height: 220 },
            aspectRatio: 1.333,
            disableFlip: false,
            formatsToSupport: BARCODE_FORMATS,
            experimentalFeatures: {
              useBarCodeDetectorIfSupported: true
            }
          },
          (decodedText) => {
            const now = Date.now();
            const normalized = String(decodedText || '').trim();

            // Prevent duplicate scans from the same frame burst.
            if (
              lastScanRef.current.value === normalized &&
              now - lastScanRef.current.at < 1500
            ) {
              return;
            }

            lastScanRef.current = { value: normalized, at: now };
            const matchedProduct = findProductByBarcodeValue(normalized);
            const added = addProductToCart(matchedProduct, 1);

            if (added) {
              showMessage(
                `Scanned: ${(matchedProduct?.name || 'Product')} added to cart.`,
                'success'
              );
            } else {
              showMessage(`No product found for barcode: ${normalized}`, 'warning');
            }
          },
          () => {
            // Ignore decode errors while scanning frames continuously.
          }
        );
      } catch (error) {
        console.error('Failed to start barcode scanner:', error);
        showMessage(
          'Could not access camera for barcode scanning. Check camera permission and HTTPS/localhost.',
          'error'
        );
        setScannerOpen(false);
        if (scannerRef.current) {
          try {
            await scannerRef.current.clear();
          } catch (clearError) {
            console.error('Failed to clear scanner after start error:', clearError);
          }
          scannerRef.current = null;
        }
      } finally {
        scannerStartingRef.current = false;
        setIsScannerStarting(false);
      }
    };

    startScanner();

    return () => {
      stopScanner();
    };
  }, [scannerOpen, findProductByBarcodeValue, addProductToCart]);

  const handleCheckout = async () => {
    if (cartItems.length === 0) {
      showMessage('Your cart is empty. Add at least one item.', 'warning');
      return;
    }

    if (!db) {
      showMessage('Database is not available. Refresh and try again.', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      const cartSnapshot = [...cartItems];
      const checkoutResult = await runTransaction(db, async (transaction) => {
        const validatedItems = [];

        for (const cartItem of cartSnapshot) {
          const productRef = doc(db, 'products', cartItem.productDocId);
          const productSnapshot = await transaction.get(productRef);

          if (!productSnapshot.exists()) {
            throw new Error(`Product no longer exists: ${cartItem.productName}`);
          }

          const productData = productSnapshot.data();
          const liveQuantity = Number(productData.quantity || 0);
          const liveUnitPrice = round2(productData.sellingPrice || 0);
          const qtyToSell = Number(cartItem.quantitySold || 0);

          if (qtyToSell <= 0 || !Number.isInteger(qtyToSell)) {
            throw new Error(`Invalid quantity in cart for ${productData.name || 'product'}.`);
          }

          if (qtyToSell > liveQuantity) {
            throw new Error(
              `Stock changed for ${productData.name || 'product'}. Available quantity is now ${liveQuantity}.`
            );
          }

          const newQuantity = liveQuantity - qtyToSell;
          const lineTotal = round2(liveUnitPrice * qtyToSell);

          transaction.update(productRef, {
            quantity: newQuantity,
            lastUpdatedBy: auth?.currentUser?.uid || null
          });

          validatedItems.push({
            productDocId: productRef.id,
            productId: productData.productId || productRef.id,
            productName: productData.name || 'Product',
            quantitySold: qtyToSell,
            unitPrice: liveUnitPrice,
            salePrice: lineTotal,
            remainingStock: newQuantity
          });
        }

        const totalSalePrice = round2(
          validatedItems.reduce((sum, item) => sum + Number(item.salePrice || 0), 0)
        );
        const totalQuantitySold = validatedItems.reduce(
          (sum, item) => sum + Number(item.quantitySold || 0),
          0
        );
        const orderId = `ORD-${Date.now()}`;
        const saleRef = doc(collection(db, 'sales'));
        const ecommerceOrderRef = doc(collection(db, 'ecommerceOrders'));
        const customerName = auth?.currentUser?.displayName || auth?.currentUser?.email || 'Walk-in Customer';
        const customerEmail = auth?.currentUser?.email || '';

        transaction.set(saleRef, {
          orderId,
          productIds: validatedItems.map((item) => item.productId),
          productNames: validatedItems.map((item) => item.productName),
          items: validatedItems.map((item) => ({
            productDocId: item.productDocId,
            productId: item.productId,
            productName: item.productName,
            quantitySold: item.quantitySold,
            unitPrice: item.unitPrice,
            salePrice: item.salePrice
          })),
          totalItems: validatedItems.length,
          totalQuantity: totalQuantitySold,
          salePrice: totalSalePrice,
          timestamp: serverTimestamp(),
          soldBy: auth?.currentUser?.uid || null,
          soldByEmail: auth?.currentUser?.email || null
        });

        transaction.set(ecommerceOrderRef, {
          orderId,
          orderNumber: orderId,
          storeName: 'inkandemotion.store',
          source: 'inkandemotion.store',
          sourceUrl: 'inkandemotion.store',
          status: 'confirmed',
          orderStatus: 'confirmed',
          paymentMethod: 'pos',
          paymentStatus: 'paid',
          customer: {
            name: customerName,
            email: customerEmail,
            phone: ''
          },
          customerName,
          customerEmail,
          customerPhone: '',
          items: validatedItems.map((item) => ({
            productDocId: item.productDocId,
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantitySold,
            quantitySold: item.quantitySold,
            unitPrice: item.unitPrice,
            salePrice: item.salePrice,
            total: item.salePrice
          })),
          totalQuantity: totalQuantitySold,
          totalAmount: totalSalePrice,
          grandTotal: totalSalePrice,
          subtotal: totalSalePrice,
          shippingFee: 0,
          discountTotal: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: 'storefront',
          inventoryApplied: true,
          processed: true
        });

        return {
          orderId,
          totalItems: validatedItems.length,
          totalQuantity: totalQuantitySold,
          salePrice: totalSalePrice,
          items: validatedItems
        };
      });

      checkoutResult.items.forEach((item) => {
        addLog('RECORD SALE', item.productName, item.quantitySold);
      });
      pushNotification('Sale completed', {
        body: `${checkoutResult.totalItems} item(s), ${checkoutResult.totalQuantity} unit(s).`
      });
      sendCrudNotification({
        title: 'Sale completed',
        body: `${checkoutResult.totalItems} item(s), ${checkoutResult.totalQuantity} unit(s).`
      });

      showMessage(
        `Checkout successful (${checkoutResult.orderId}). Total: ${formatCurrency(checkoutResult.salePrice)}.`,
        'success'
      );
      setCartItems([]);
      setQuantity('');
    } catch (error) {
      console.error('Checkout failed:', error);
      showMessage(error.message || 'Checkout failed. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const messageColor =
    message.type === 'success' ? '#0a7b00' : message.type === 'warning' ? '#9B870C' : '#b00020';

  return (
    <DashboardLayout>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          marginBottom: '20px'
        }}
      >
        <div style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-dark)' }}>
          Record Sale (POS Cart)
        </div>
        <button
          onClick={() => setScannerOpen((previous) => !previous)}
          disabled={isScannerStarting || isSubmitting}
          style={{
            padding: '10px 14px',
            background: scannerOpen ? '#dc2626' : '#0ea5e9',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: isScannerStarting || isSubmitting ? 'not-allowed' : 'pointer',
            opacity: isScannerStarting || isSubmitting ? 0.65 : 1
          }}
        >
          {scannerOpen ? 'Stop Barcode Scanner' : 'Scan Barcode / QR'}
        </button>
      </div>

      <div
        style={{
          backgroundColor: 'var(--card)',
          padding: '25px',
          borderRadius: '12px',
          boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
          maxWidth: '760px'
        }}
      >
        <div
          style={{
            marginBottom: '16px',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              background: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              padding: '10px 12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap'
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '14px', color: '#334155' }}>
              Barcode Scanner (Camera)
            </div>
            <button
              onClick={() => setScannerOpen((previous) => !previous)}
              disabled={isScannerStarting || isSubmitting}
              style={{
                padding: '8px 12px',
                background: scannerOpen ? '#dc2626' : '#0ea5e9',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: isScannerStarting || isSubmitting ? 'not-allowed' : 'pointer',
                opacity: isScannerStarting || isSubmitting ? 0.65 : 1
              }}
            >
              {scannerOpen ? 'Stop Scanner' : 'Start Scanner'}
            </button>
          </div>

          {scannerOpen ? (
            <div style={{ padding: '10px 12px' }}>
              <div
                id={SCANNER_ELEMENT_ID}
                style={{ width: '100%', minHeight: '220px', borderRadius: '8px', overflow: 'hidden' }}
              />
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#64748b' }}>
                Point camera at product barcode. Each successful scan adds 1 unit to cart.
              </div>
            </div>
          ) : (
            <div style={{ padding: '10px 12px', fontSize: '12px', color: '#64748b' }}>
              Scanner is off. Start scanner to add products by barcode instantly.
            </div>
          )}
        </div>

        {message.text && (
          <div
            style={{
              marginBottom: '14px',
              padding: '10px',
              borderRadius: '8px',
              border: `1px solid ${messageColor}33`,
              color: messageColor,
              background: `${messageColor}14`,
              fontSize: '14px'
            }}
          >
            {message.text}
          </div>
        )}

        <div style={{ marginBottom: '15px' }}>
          <label
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--text-dark)',
              display: 'block',
              marginBottom: '6px'
            }}
          >
            Product
          </label>
          <select
            value={selectedProductId}
            onChange={(event) => setSelectedProductId(event.target.value)}
            disabled={loadingProducts || isSubmitting}
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #ccc',
              borderRadius: '6px',
              fontSize: '14px',
              backgroundColor: 'var(--card)',
              color: 'var(--text-dark)'
            }}
          >
            <option value="">Select product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {`${product.name || 'Unnamed product'} (${product.productId || product.id}) - Stock: ${
                  Number(product.quantity || 0)
                }`}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--text-dark)',
              display: 'block',
              marginBottom: '6px'
            }}
          >
            Quantity to Sell
          </label>
          <input
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            disabled={!selectedProduct || isSubmitting}
            placeholder="Enter quantity"
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #ccc',
              borderRadius: '6px',
              fontSize: '14px',
              backgroundColor: 'var(--card)',
              color: 'var(--text-dark)'
            }}
          />
        </div>

        <div
          style={{
            marginBottom: '16px',
            padding: '12px',
            borderRadius: '8px',
            background: 'rgba(37, 99, 235, 0.08)',
            border: '1px solid rgba(37, 99, 235, 0.15)'
          }}
        >
          <div style={{ fontSize: '14px', color: 'var(--text-dark)', marginBottom: '4px' }}>
            Unit Price: <strong>{formatCurrency(unitPrice)}</strong>
          </div>
          <div style={{ fontSize: '14px', color: 'var(--text-dark)', marginBottom: '4px' }}>
            Available Stock: <strong>{availableQuantity}</strong>
          </div>
          <div style={{ fontSize: '15px', color: 'var(--text-dark)' }}>
            Total: <strong>{formatCurrency(totalPrice)}</strong>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
          <button
            onClick={handleAddToCart}
            disabled={loadingProducts || isSubmitting || !selectedProduct || !quantity}
            style={{
              flex: 1,
              padding: '12px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: loadingProducts || isSubmitting || !selectedProduct || !quantity ? 'not-allowed' : 'pointer',
              opacity: loadingProducts || isSubmitting || !selectedProduct || !quantity ? 0.65 : 1
            }}
          >
            Add To Cart
          </button>
          <button
            onClick={() => setCartItems([])}
            disabled={isSubmitting || cartItems.length === 0}
            style={{
              padding: '12px',
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: isSubmitting || cartItems.length === 0 ? 'not-allowed' : 'pointer',
              opacity: isSubmitting || cartItems.length === 0 ? 0.65 : 1
            }}
          >
            Clear Cart
          </button>
        </div>

        <div
          style={{
            marginBottom: '16px',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              background: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              padding: '10px 12px',
              fontWeight: 600,
              fontSize: '14px',
              color: '#334155'
            }}
          >
            Cart Items ({cartItems.length})
          </div>
          {cartItems.length === 0 ? (
            <div style={{ padding: '12px', fontSize: '13px', color: '#64748b' }}>
              Cart is empty.
            </div>
          ) : (
            cartItems.map((item) => (
              <div
                key={item.productDocId}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto auto',
                  gap: '10px',
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderBottom: '1px solid #f1f5f9'
                }}
              >
                <div style={{ fontSize: '13px', color: 'var(--text-dark)' }}>
                  {item.productName} ({item.productId})
                </div>
                <div style={{ fontSize: '13px', color: '#475569' }}>x{item.quantitySold}</div>
                <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>
                  {formatCurrency(item.salePrice)}
                </div>
                <button
                  onClick={() => handleRemoveFromCart(item.productDocId)}
                  disabled={isSubmitting}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#dc2626',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    fontWeight: 600
                  }}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>

        <div
          style={{
            marginBottom: '16px',
            padding: '12px',
            borderRadius: '8px',
            background: 'rgba(22, 163, 74, 0.09)',
            border: '1px solid rgba(22, 163, 74, 0.22)'
          }}
        >
          <div style={{ fontSize: '14px', color: 'var(--text-dark)', marginBottom: '3px' }}>
            Total Units: <strong>{totalCartQty}</strong>
          </div>
          <div style={{ fontSize: '15px', color: 'var(--text-dark)' }}>
            Grand Total: <strong>{formatCurrency(cartTotal)}</strong>
          </div>
        </div>

        <button
          onClick={handleCheckout}
          disabled={isSubmitting || cartItems.length === 0}
          style={{
            width: '100%',
            padding: '12px',
            background: isSubmitting ? '#94a3b8' : '#16a34a',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '15px',
            fontWeight: 600,
            cursor: isSubmitting ? 'not-allowed' : 'pointer'
          }}
        >
          {isSubmitting ? 'Processing Checkout...' : 'Checkout'}
        </button>
      </div>
    </DashboardLayout>
  );
}
