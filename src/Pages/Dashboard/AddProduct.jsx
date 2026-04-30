import React, { useState, useEffect, useRef } from 'react';
import DashboardLayout from '../../Components/DashboardLayout';
import { collection, addDoc, serverTimestamp, onSnapshot, query } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { addLog } from '../../lib/firebase-logs';
import { pushNotification, sendCrudNotification } from '../../lib/notifications';
import { syncProductToStore } from '../../lib/inkandemotion-sync';
import { Html5Qrcode } from 'html5-qrcode';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType, NotFoundException } from '@zxing/library';

const SMART_PRICING_FUNCTION_URL = 'https://us-central1-smartstock-fyp.cloudfunctions.net/groqChat';
const SMART_PRICING_MODEL = 'llama-3.1-8b-instant';

const SCANNER_ELEMENT_ID = 'smartstock-add-product-barcode-scanner';
const IMAGE_SCANNER_ELEMENT_ID = 'smartstock-add-product-image-scanner';
const ZXING_FORMATS = [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.PDF_417,
  BarcodeFormat.AZTEC
];

export default function AddProduct() {
  const [formData, setFormData] = useState({
    productId: '',
    barcode: '',
    name: '',
    category: '',
    ptaStatus: '',
    quantity: '',
    purchasePrice: '',
    sellingPrice: '',
    warehouse: '',
    vendorName: '',
    vendorEmail: '',
    threshold: 5
  });
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [isScannerStarting, setIsScannerStarting] = useState(false);
  const [isFetchingBarcodeDetails, setIsFetchingBarcodeDetails] = useState(false);
  const [isSuggestingPrice, setIsSuggestingPrice] = useState(false);
  const [priceSuggestion, setPriceSuggestion] = useState(null);
  const [scannerStatus, setScannerStatus] = useState('Scanner off.');
  const [imageScanName, setImageScanName] = useState('');
  const scannerRef = useRef(null);
  const lastScanRef = useRef({ value: '', at: 0 });

  const round2 = (num) => Math.round(Number(num || 0) * 100) / 100;

  const applyBarcodeDetails = (barcodeValue, details) => {
    setFormData((previous) => {
      const next = { ...previous };

      if (barcodeValue) {
        next.barcode = barcodeValue;
        if (!next.productId.trim()) {
          next.productId = `AUTO-${barcodeValue}`;
        }
      }

      if (details?.name && !next.name.trim()) {
        next.name = details.name;
      }
      if (details?.category && !next.category.trim()) {
        next.category = details.category;
      }
      if (!String(next.category || '').trim().toLowerCase().includes('mobile')) {
        next.ptaStatus = '';
      }
      if (details?.brand && !next.vendorName.trim()) {
        next.vendorName = details.brand;
      }

      return next;
    });
  };

  const fetchProductDetailsFromBarcode = async (barcodeValue) => {
    const normalized = String(barcodeValue || '').trim();
    if (!normalized) {
      showMessage('Enter or scan a barcode first.', 'warning');
      return;
    }

    setIsFetchingBarcodeDetails(true);
    setScannerStatus(`Looking up barcode ${normalized} online...`);

    try {
      const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(normalized)}.json`);
      if (!response.ok) {
        throw new Error(`Lookup failed with status ${response.status}`);
      }

      const payload = await response.json();
      const product = payload?.product;
      const productFound = payload?.status === 1 && product;

      if (!productFound) {
        applyBarcodeDetails(normalized, null);
        setScannerStatus(`Barcode ${normalized} found, but no online details were returned.`);
        showMessage('Barcode read successfully, but online details were not found. Fill fields manually.', 'warning');
        return;
      }

      const categoryText = Array.isArray(product.categories_tags) && product.categories_tags.length > 0
        ? String(product.categories_tags[0] || '').replace(/^en:/, '').replace(/-/g, ' ')
        : String(product.categories || '').split(',')[0]?.trim();

      const details = {
        name: String(product.product_name || product.generic_name || '').trim(),
        category: String(categoryText || '').trim(),
        brand: String(product.brands || '').split(',')[0]?.trim() || ''
      };

      applyBarcodeDetails(normalized, details);
      setScannerStatus(`Online details loaded for barcode ${normalized}.`);
      showMessage('Product details auto-filled from online barcode database.', 'success');
    } catch (error) {
      console.error('Online barcode lookup failed:', error);
      applyBarcodeDetails(normalized, null);
      setScannerStatus('Barcode captured, but online lookup failed.');
      showMessage('Barcode captured. Could not fetch online details right now.', 'warning');
    } finally {
      setIsFetchingBarcodeDetails(false);
    }
  };

  useEffect(() => {
    if (!db) return;

    const warehousesQuery = query(collection(db, 'warehouses'));
    const unsubscribe = onSnapshot(
      warehousesQuery,
      (snapshot) => {
        const warehousesData = [];
        snapshot.forEach((doc) => {
          warehousesData.push({ name: doc.data().name, id: doc.id });
        });
        setWarehouses(warehousesData);
      },
      (error) => {
        console.error('Error loading warehouses:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!db) return;

    const productsQuery = query(collection(db, 'products'));
    const unsubscribe = onSnapshot(
      productsQuery,
      (snapshot) => {
        const productsData = [];
        snapshot.forEach((productDoc) => {
          productsData.push({ id: productDoc.id, ...productDoc.data() });
        });
        setProducts(productsData);
      },
      (error) => {
        console.error('Error loading products:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let reader = null;
    let controls = null;
    let cancelled = false;

    const stopScanner = async () => {
      if (controls) {
        try {
          controls.stop();
        } catch (error) {
          console.error('Failed to stop ZXing scanner controls:', error);
        }
        controls = null;
      }

      if (!reader) return;
      try {
        reader.reset();
      } catch (error) {
        console.error('Failed to reset ZXing scanner:', error);
      }

      const scannerHost = document.getElementById(SCANNER_ELEMENT_ID);
      if (scannerHost) {
        scannerHost.innerHTML = '';
      }

      reader = null;
      scannerRef.current = null;
    };

    const startScanner = async () => {
      if (!scannerOpen) {
        setScannerStatus('Scanner off.');
        await stopScanner();
        return;
      }

      if (scannerRef.current) return;

      setIsScannerStarting(true);
      setScannerStatus('Starting camera scanner...');

      try {
        const scannerHost = document.getElementById(SCANNER_ELEMENT_ID);
        if (!scannerHost) {
          throw new Error('Scanner container not found');
        }
        scannerHost.innerHTML = '';

        const videoElement = document.createElement('video');
        videoElement.setAttribute('autoplay', 'true');
        videoElement.setAttribute('muted', 'true');
        videoElement.setAttribute('playsinline', 'true');
        videoElement.style.width = '100%';
        videoElement.style.minHeight = '320px';
        videoElement.style.background = '#000';
        videoElement.style.borderRadius = '6px';
        videoElement.style.objectFit = 'cover';
        scannerHost.appendChild(videoElement);

        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS);
        reader = new BrowserMultiFormatReader(hints, 300);
        scannerRef.current = reader;

        controls = await reader.decodeFromVideoDevice(undefined, videoElement, (result, error) => {
          if (result) {
            const rawValue = String(result.getText() || '').trim();
            if (!rawValue) return;

            const now = Date.now();
            if (lastScanRef.current.value === rawValue && now - lastScanRef.current.at < 1500) {
              return;
            }

            lastScanRef.current = { value: rawValue, at: now };
            setScannerStatus(`Detected: ${rawValue}`);
            showMessage(`Barcode scanned: ${rawValue}`, 'success');
            fetchProductDetailsFromBarcode(rawValue);
            setScannerOpen(false);
            return;
          }

          if (error && !(error instanceof NotFoundException)) {
            console.error('ZXing decode error:', error);
          }
          setScannerStatus('Scanning... point the barcode at the camera.');
        });
      } catch (error) {
        console.error('Failed to start ZXing camera scanner:', error);
        setScannerStatus('Could not start live scanner. Try Chrome/Edge and allow camera access.');
        showMessage('Could not start live scanner. Check camera permission.', 'error');
        await stopScanner();
        setScannerOpen(false);
      } finally {
        if (!cancelled) {
          setIsScannerStarting(false);
        }
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [scannerOpen]);

  const handleScanFromImage = async (e) => {
    const file = e.target.files?.[0];
    const fileName = file?.name || '';
    e.target.value = '';
    if (!file) return;

    setImageScanName(fileName);
    setScannerStatus(`Reading image: ${fileName}`);

    try {
      let normalized = '';

      if ('BarcodeDetector' in window) {
        const detector = new window.BarcodeDetector({
          formats: [
            'qr_code',
            'code_128',
            'code_39',
            'code_93',
            'ean_13',
            'ean_8',
            'upc_a',
            'upc_e',
            'itf',
            'codabar',
            'data_matrix',
            'pdf417',
            'aztec'
          ]
        });

        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
          throw new Error('Canvas context unavailable');
        }

        context.drawImage(bitmap, 0, 0);
        const results = await detector.detect(canvas);
        normalized = String(results?.[0]?.rawValue || '').trim();
      }

      if (!normalized) {
        const tmpScanner = new Html5Qrcode(IMAGE_SCANNER_ELEMENT_ID);
        const result = await tmpScanner.scanFile(file, false);
        normalized = String(result || '').trim();
      }

      if (!normalized) {
        showMessage('No barcode found in image.', 'warning');
        setScannerStatus('No barcode detected in image. Try a clearer photo.');
        return;
      }
      setScannerStatus(`Image barcode detected: ${normalized}`);
      showMessage(`Barcode detected from image: ${normalized}`, 'success');
      fetchProductDetailsFromBarcode(normalized);
    } catch (error) {
      console.error('Image barcode scan failed:', error);
      setScannerStatus('Could not read barcode from image.');
      showMessage('Could not read barcode from image. Try a clearer photo.', 'warning');
    }
  };

  const handleToggleScanner = () => {
    setScannerOpen((previous) => !previous);
  };

  const handleClearBarcode = () => {
    setFormData((previous) => ({ ...previous, barcode: '' }));
    setImageScanName('');
    setScannerStatus('Scanner off.');
  };

  const showMessage = (text, type = 'error') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 5000);
  };

  const handleChange = (e) => {
    if (['name', 'category', 'purchasePrice'].includes(e.target.name)) {
      setPriceSuggestion(null);
    }

    setFormData((previous) => {
      const next = {
        ...previous,
        [e.target.name]: e.target.value
      };

      if (e.target.name === 'category' && !String(e.target.value || '').trim().toLowerCase().includes('mobile')) {
        next.ptaStatus = '';
      }

      return next;
    });
  };

  const extractSuggestedPricePayload = (content) => {
    if (!content) return null;

    if (typeof content === 'object') {
      return content;
    }

    const text = String(content).trim();
    if (!text) return null;

    const tryParse = (value) => {
      try {
        return JSON.parse(value);
      } catch (error) {
        return null;
      }
    };

    const directParse = tryParse(text);
    if (directParse) {
      return directParse;
    }

    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      const fencedParse = tryParse(fencedMatch[1].trim());
      if (fencedParse) {
        return fencedParse;
      }
    }

    const startIndex = text.indexOf('{');
    const endIndex = text.lastIndexOf('}');
    if (startIndex >= 0 && endIndex > startIndex) {
      return tryParse(text.slice(startIndex, endIndex + 1));
    }

    return null;
  };

  const normalizePriceSuggestions = (payload) => {
    const suggestions = Array.isArray(payload?.priceSuggestions)
      ? payload.priceSuggestions
      : Array.isArray(payload?.suggestions)
        ? payload.suggestions
        : [];

    return suggestions
      .map((item) => ({
        price: Number(item?.price ?? item?.suggestedPrice),
        reasoning: String(item?.reasoning || item?.explanation || '').trim(),
        comparison: String(item?.comparison || '').trim(),
        label: String(item?.label || item?.tier || '').trim()
      }))
      .filter((item) => Number.isFinite(item.price) && item.price > 0);
  };

  const requestSmartPricing = async (prompt, useDirectGroq = false) => {
    if (useDirectGroq) {
      const apiKey = process.env.REACT_APP_GROQ_API_KEY || '';

      if (!apiKey) {
        throw new Error('Direct AI fallback is unavailable because REACT_APP_GROQ_API_KEY is not set.');
      }

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          model: SMART_PRICING_MODEL,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      });

      const responseText = await response.text();
      let data = null;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch (error) {
        data = { raw: responseText };
      }

      if (!response.ok) {
        const errorMessage =
          data?.error?.message ||
          data?.error ||
          data?.raw ||
          `Groq request failed with status ${response.status}`;
        throw new Error(errorMessage);
      }

      return data;
    }

    const response = await fetch(SMART_PRICING_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        model: SMART_PRICING_MODEL,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    const responseText = await response.text();
    let data = null;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch (error) {
      data = { raw: responseText };
    }

    if (!response.ok) {
      const errorMessage =
        data?.error?.message ||
        data?.error ||
        data?.raw ||
        `Pricing request failed with status ${response.status}`;
      throw new Error(errorMessage);
    }

    return data;
  };

  const handleSuggestPrice = async () => {
    const name = String(formData.name || '').trim();
    const category = String(formData.category || '').trim();
    const purchasePrice = Number(formData.purchasePrice);

    if (!name || !category || !Number.isFinite(purchasePrice) || purchasePrice <= 0) {
      showMessage('⚠️ Enter product name, category, and purchase price first.', 'warning');
      return;
    }

    setIsSuggestingPrice(true);
    setMessage({ text: '', type: '' });

    try {
      const prompt = `Act as a retail pricing expert. For a product named ${name} in the ${category} category with a cost price of ${purchasePrice} PKR, analyze market competitiveness and suggest pricing options. Return ONLY a JSON object in this exact format: {"competitorName": "string", "competitorPrice": number, "bestPrice": number, "reasoning": "short explanation", "priceSuggestions": [{"label": "string", "price": number, "reasoning": "short explanation", "comparison": "short comparison with competitor"}]}. Include at least 3 priceSuggestions. If there are multiple relevant competitors, choose the closest comparable competitor and identify it by name.`;

      let data;
      try {
        data = await requestSmartPricing(prompt, false);
      } catch (primaryError) {
        console.warn('Smart pricing function failed, retrying with direct Groq fallback:', primaryError);
        data = await requestSmartPricing(prompt, true);
      }

      const assistantContent = data?.choices?.[0]?.message?.content;
      const payload = extractSuggestedPricePayload(assistantContent);
      const suggestions = normalizePriceSuggestions(payload);
      const bestPrice = Number(payload?.bestPrice ?? payload?.suggestedPrice ?? suggestions[0]?.price);
      const reasoning = String(payload?.reasoning || suggestions[0]?.reasoning || '').trim();
      const competitorName = String(payload?.competitorName || '').trim() || 'Unknown competitor';
      const competitorPrice = Number(payload?.competitorPrice);

      if (!Number.isFinite(bestPrice) || bestPrice <= 0) {
        throw new Error(data?.raw || 'AI response did not include a valid suggested price.');
      }

      const normalizedPrice = round2(bestPrice);
      setFormData((previous) => ({
        ...previous,
        sellingPrice: String(normalizedPrice)
      }));
      setPriceSuggestion({
        competitorName,
        competitorPrice: Number.isFinite(competitorPrice) && competitorPrice > 0 ? round2(competitorPrice) : null,
        price: normalizedPrice,
        reasoning: reasoning || 'Suggested based on market competitiveness and target margin.',
        suggestions
      });
      showMessage('✅ Selling price suggested and applied.', 'success');
    } catch (error) {
      console.error('Smart pricing request failed:', error);
      setPriceSuggestion(null);
      showMessage(`❌ Could not suggest a price right now. ${error.message || 'Try again.'}`, 'error');
    } finally {
      setIsSuggestingPrice(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });

    const { productId, barcode, name, category, quantity, purchasePrice, sellingPrice, warehouse } = formData;
    const ptaStatus = String(formData.ptaStatus || '').trim();
    const normalizedBarcode = barcode.trim();
    const normalizedProductId = productId.trim() || `AUTO-${normalizedBarcode}`;

    // Validate inputs
    if (!name.trim() || !category.trim() || !quantity || !purchasePrice || !sellingPrice || !warehouse) {
      showMessage('⚠️ Please fill all fields', 'warning');
      return;
    }

    if (category.trim().toLowerCase().includes('mobile') && !ptaStatus) {
      showMessage('⚠️ Please select PTA or NON-PTA for mobile products.', 'warning');
      return;
    }

    if (!normalizedBarcode) {
      showMessage('⚠️ Please scan or enter a barcode', 'warning');
      return;
    }

    const duplicateProductId = products.some(
      (product) => String(product.productId || '').trim().toLowerCase() === normalizedProductId.toLowerCase()
    );
    if (duplicateProductId) {
      showMessage('⚠️ Product ID already exists. Use a unique Product ID.', 'warning');
      return;
    }

    const duplicateBarcode = products.some(
      (product) => String(product.barcode || '').trim() === normalizedBarcode
    );
    if (duplicateBarcode) {
      showMessage('⚠️ Barcode already exists. Scan/enter a different barcode.', 'warning');
      return;
    }

    const qtyNum = Number(quantity);
    const priceNum = round2(purchasePrice);
    const sellNum = round2(sellingPrice);

    if (qtyNum < 0 || !Number.isInteger(qtyNum)) {
      showMessage('⚠️ Quantity must be a positive whole number', 'warning');
      return;
    }
    if (priceNum <= 0) {
      showMessage('⚠️ Purchase price must be greater than 0', 'warning');
      return;
    }
    if (sellNum <= 0) {
      showMessage('⚠️ Selling price must be greater than 0', 'warning');
      return;
    }
    if (sellNum <= priceNum) {
      showMessage('⚠️ Selling price should be higher than purchase price', 'warning');
      return;
    }

    if (!db) {
      showMessage('❌ Database not initialized. Please refresh the page.', 'error');
      return;
    }

    setIsLoading(true);
    showMessage('Adding product...', 'warning');

    try {
      await addDoc(collection(db, 'products'), {
        productId: normalizedProductId,
        barcode: normalizedBarcode,
        name: name.trim(),
        category: category.trim(),
        quantity: qtyNum,
        purchasePrice: priceNum,
        sellingPrice: sellNum,
        ptaStatus: category.trim().toLowerCase().includes('mobile') ? ptaStatus : '',
        warehouse: warehouse.trim(),
        vendorName: formData.vendorName.trim(),
        vendorEmail: formData.vendorEmail.trim(),
        threshold: Number(formData.threshold) > 0 ? Number(formData.threshold) : 5,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser.uid,
        lastUpdatedBy: auth.currentUser.uid
      });

      // Queue product for InkandEmotion sync
      try {
        await syncProductToStore({
          productId: normalizedProductId,
          barcode: normalizedBarcode,
          name: name.trim(),
          category: category.trim(),
          quantity: qtyNum,
          purchasePrice: priceNum,
          sellingPrice: sellNum,
          warehouse: warehouse.trim(),
          vendorName: formData.vendorName.trim()
        });
      } catch (syncErr) {
        console.warn('Product sync queued (may be delayed):', syncErr);
      }

      // Log the action
      addLog('ADD PRODUCT', name.trim(), qtyNum);
      pushNotification('Product added', {
        body: `${name.trim()} (Qty: ${qtyNum}) was added to ${warehouse.trim()}.`
      });
      sendCrudNotification({
        title: 'Product added',
        body: `${name.trim()} (Qty: ${qtyNum}) was added to ${warehouse.trim()}.`
      });

      showMessage('✅ Product Added Successfully', 'success');
      // Reset form
      setFormData({
        productId: '',
        barcode: '',
        name: '',
        category: '',
        ptaStatus: '',
        quantity: '',
        purchasePrice: '',
        sellingPrice: '',
        warehouse: '',
        vendorName: '',
        vendorEmail: '',
        threshold: 5
      });
    } catch (err) {
      console.error('Error adding product:', err);
      showMessage('❌ Error: ' + (err.message || 'Failed to add product'), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const getMessageColor = () => {
    if (message.type === 'success') return '#0a7b00';
    if (message.type === 'warning') return '#9B870C';
    return '#b00020';
  };

  return (
    <DashboardLayout>
      <div style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-dark)', marginBottom: '20px' }}>
        Add New Product
      </div>

      <div
        style={{
          backgroundColor: 'var(--card)',
          padding: '25px',
          borderRadius: '12px',
          boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
          maxWidth: '450px'
        }}
      >
        <div id={IMAGE_SCANNER_ELEMENT_ID} style={{ display: 'none' }} />
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
              Product ID
            </label>
            <input
              type="text"
              name="productId"
              placeholder="e.g. PROD-001"
              maxLength="50"
              value={formData.productId}
              onChange={handleChange}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ccc',
                borderRadius: '6px',
                marginTop: '5px',
                fontSize: '14px',
                backgroundColor: 'var(--card)',
                color: 'var(--text-dark)'
              }}
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
              Barcode
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input
                type="text"
                name="barcode"
                placeholder="Scan with camera or type barcode"
                maxLength="120"
                value={formData.barcode}
                onChange={handleChange}
                onBlur={() => {
                  const value = String(formData.barcode || '').trim();
                  if (value) {
                    fetchProductDetailsFromBarcode(value);
                  }
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  border: '1px solid #ccc',
                  borderRadius: '6px',
                  marginTop: '5px',
                  fontSize: '14px',
                  backgroundColor: 'var(--card)',
                  color: 'var(--text-dark)'
                }}
              />
              <button
                type="button"
                onClick={handleToggleScanner}
                disabled={isLoading || isScannerStarting || isFetchingBarcodeDetails}
                style={{
                  marginTop: '5px',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: scannerOpen ? '#dc2626' : '#0ea5e9',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isLoading || isScannerStarting || isFetchingBarcodeDetails ? 'not-allowed' : 'pointer',
                  opacity: isLoading || isScannerStarting || isFetchingBarcodeDetails ? 0.65 : 1
                }}
              >
                {scannerOpen ? 'Stop' : 'Scan'}
              </button>
            </div>
            <small style={{ color: '#64748b', display: 'block', marginTop: '6px' }}>
              Use Scan for live camera, or Test Image to verify decoder with a barcode photo.
            </small>
            <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input
                id="barcode-image-input"
                type="file"
                accept="image/*"
                onChange={handleScanFromImage}
                disabled={isLoading || isScannerStarting}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                onClick={() => document.getElementById('barcode-image-input')?.click()}
                disabled={isLoading || isScannerStarting || isFetchingBarcodeDetails}
                style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  color: '#0f172a',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isLoading || isScannerStarting || isFetchingBarcodeDetails ? 'not-allowed' : 'pointer',
                  opacity: isLoading || isScannerStarting || isFetchingBarcodeDetails ? 0.65 : 1
                }}
              >
                Upload barcode image
              </button>
              <button
                type="button"
                onClick={() => fetchProductDetailsFromBarcode(formData.barcode)}
                disabled={isLoading || isScannerStarting || isFetchingBarcodeDetails || !String(formData.barcode || '').trim()}
                style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  color: '#0f172a',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isLoading || isScannerStarting || isFetchingBarcodeDetails || !String(formData.barcode || '').trim() ? 'not-allowed' : 'pointer',
                  opacity: isLoading || isScannerStarting || isFetchingBarcodeDetails || !String(formData.barcode || '').trim() ? 0.65 : 1
                }}
              >
                {isFetchingBarcodeDetails ? 'Fetching Details...' : 'Auto Fill From Internet'}
              </button>
              <button
                type="button"
                onClick={handleClearBarcode}
                disabled={isLoading || isScannerStarting || isFetchingBarcodeDetails}
                style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  color: '#0f172a',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isLoading || isScannerStarting || isFetchingBarcodeDetails ? 'not-allowed' : 'pointer',
                  opacity: isLoading || isScannerStarting || isFetchingBarcodeDetails ? 0.65 : 1
                }}
              >
                Clear
              </button>
            </div>
            {imageScanName && (
              <small style={{ color: '#0f172a', display: 'block', marginTop: '4px', fontWeight: 600 }}>
                Selected image: {imageScanName}
              </small>
            )}
            {scannerOpen && (
              <div
                style={{
                  marginTop: '10px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '8px',
                  background: '#f8fafc'
                }}
              >
                <div
                  id={SCANNER_ELEMENT_ID}
                  style={{ width: '100%', minHeight: '320px', background: '#fff', borderRadius: '6px', overflow: 'hidden' }}
                />
                <small style={{ color: '#64748b', display: 'block', marginTop: '6px' }}>
                  Point camera at barcode and it will fill this field automatically.
                </small>
                <small style={{ color: '#0f172a', display: 'block', marginTop: '4px', fontWeight: 600 }}>
                  {scannerStatus}
                </small>
              </div>
            )}
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
              Product Name
            </label>
            <input
              type="text"
              name="name"
              placeholder="e.g. iPhone 14"
              maxLength="100"
              value={formData.name}
              onChange={handleChange}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ccc',
                borderRadius: '6px',
                marginTop: '5px',
                fontSize: '14px',
                backgroundColor: 'var(--card)',
                color: 'var(--text-dark)'
              }}
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
              Category
            </label>
            <input
              type="text"
              name="category"
              placeholder="e.g. Mobile Phones"
              maxLength="50"
              value={formData.category}
              onChange={handleChange}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ccc',
                borderRadius: '6px',
                marginTop: '5px',
                fontSize: '14px',
                backgroundColor: 'var(--card)',
                color: 'var(--text-dark)'
              }}
            />
          </div>

          {String(formData.category || '').trim().toLowerCase().includes('mobile') && (
            <div style={{ marginBottom: '15px' }}>
              <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
                Phone Status
              </label>
              <select
                name="ptaStatus"
                value={formData.ptaStatus}
                onChange={handleChange}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ccc',
                  borderRadius: '6px',
                  marginTop: '5px',
                  fontSize: '14px',
                  backgroundColor: 'var(--card)',
                  color: 'var(--text-dark)'
                }}
              >
                <option value="">Select PTA status</option>
                <option value="PTA">PTA</option>
                <option value="NON-PTA">NON-PTA</option>
              </select>
            </div>
          )}

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
              Stock Quantity
            </label>
            <input
              type="number"
              name="quantity"
              placeholder="e.g. 10"
              min="0"
              step="1"
              value={formData.quantity}
              onChange={handleChange}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ccc',
                borderRadius: '6px',
                marginTop: '5px',
                fontSize: '14px',
                backgroundColor: 'var(--card)',
                color: 'var(--text-dark)'
              }}
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
              Purchase Price
            </label>
            <input
              type="number"
              name="purchasePrice"
              placeholder="e.g. 20000"
              min="0"
              step="0.01"
              value={formData.purchasePrice}
              onChange={handleChange}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ccc',
                borderRadius: '6px',
                marginTop: '5px',
                fontSize: '14px',
                backgroundColor: 'var(--card)',
                color: 'var(--text-dark)'
              }}
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
              Selling Price
            </label>
            <small style={{ color: '#64748b', display: 'block', marginBottom: '6px', lineHeight: 1.4 }}>
              Smart Pricing suggests the best price based on demand and competitor pricing so you can earn more while staying competitive.
            </small>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
              <input
                type="number"
                name="sellingPrice"
                placeholder="e.g. 24000"
                min="0"
                step="0.01"
                value={formData.sellingPrice}
                onChange={handleChange}
                style={{
                  flex: 1,
                  padding: '10px',
                  border: '1px solid #ccc',
                  borderRadius: '6px',
                  marginTop: '5px',
                  fontSize: '14px',
                  backgroundColor: 'var(--card)',
                  color: 'var(--text-dark)'
                }}
              />
              <button
                type="button"
                onClick={handleSuggestPrice}
                disabled={isLoading || isSuggestingPrice || !String(formData.name || '').trim() || !String(formData.category || '').trim() || !String(formData.purchasePrice || '').trim()}
                style={{
                  marginTop: '5px',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: '1px solid #f59e0b',
                  background: 'linear-gradient(135deg, #f59e0b, #f97316)',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: isLoading || isSuggestingPrice || !String(formData.name || '').trim() || !String(formData.category || '').trim() || !String(formData.purchasePrice || '').trim() ? 'not-allowed' : 'pointer',
                  opacity: isLoading || isSuggestingPrice || !String(formData.name || '').trim() || !String(formData.category || '').trim() || !String(formData.purchasePrice || '').trim() ? 0.7 : 1,
                  whiteSpace: 'nowrap'
                }}
              >
                {isSuggestingPrice ? '✨ Thinking...' : '✨ Auto-Price'}
              </button>
            </div>
            {priceSuggestion && (
              <div style={{ display: 'block', marginTop: '6px', color: '#0f172a', lineHeight: 1.45, fontSize: '12px' }}>
                <div style={{ fontWeight: 700 }}>
                  Best price: {priceSuggestion.price} PKR
                </div>
                <div style={{ marginTop: '2px' }}>
                  Competitor: {priceSuggestion.competitorName}
                  {priceSuggestion.competitorPrice != null ? ` at ${priceSuggestion.competitorPrice} PKR` : ''}
                </div>
                <div style={{ marginTop: '2px' }}>
                  {priceSuggestion.reasoning}
                </div>
                {priceSuggestion.suggestions?.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>Price options</div>
                    <div style={{ display: 'grid', gap: '6px' }}>
                      {priceSuggestion.suggestions.map((item) => (
                        <div key={`${item.label}-${item.price}`} style={{ padding: '8px', border: '1px solid #e2e8f0', borderRadius: '6px', background: '#f8fafc' }}>
                          <div style={{ fontWeight: 700 }}>
                            {(item.label || 'Option').trim()}: {item.price} PKR
                          </div>
                          {item.comparison && <div>{item.comparison}</div>}
                          {item.reasoning && <div style={{ color: '#475569' }}>{item.reasoning}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
              Warehouse *
            </label>
            <select
              name="warehouse"
              value={formData.warehouse}
              onChange={handleChange}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ccc',
                borderRadius: '6px',
                marginTop: '5px',
                fontSize: '14px',
                backgroundColor: 'var(--card)',
                color: 'var(--text-dark)'
              }}
            >
              <option value="">Select a warehouse</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.name}>{w.name}</option>
              ))}
            </select>
            {warehouses.length === 0 && (
              <small style={{ color: '#ef4444', display: 'block', marginTop: '5px' }}>
                📍 No warehouses found. Create one in Warehouses section first.
              </small>
            )}
          </div>

          <div style={{ marginBottom: '0', paddingTop: '10px', borderTop: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#6b7280', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Vendor Info (optional)
            </div>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
              Vendor Name
            </label>
            <input
              type="text"
              name="vendorName"
              placeholder="e.g. Ali Traders"
              maxLength="100"
              value={formData.vendorName}
              onChange={handleChange}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ccc',
                borderRadius: '6px',
                marginTop: '5px',
                fontSize: '14px',
                backgroundColor: 'var(--card)',
                color: 'var(--text-dark)'
              }}
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
              Vendor Email
              <span style={{ fontSize: '11px', fontWeight: 400, color: '#6b7280', marginLeft: '6px' }}>auto-emailed when stock goes low</span>
            </label>
            <input
              type="email"
              name="vendorEmail"
              placeholder="e.g. vendor@example.com"
              maxLength="150"
              value={formData.vendorEmail}
              onChange={handleChange}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ccc',
                borderRadius: '6px',
                marginTop: '5px',
                fontSize: '14px',
                backgroundColor: 'var(--card)',
                color: 'var(--text-dark)'
              }}
            />
          </div>

          <div style={{ marginBottom: '0', paddingTop: '10px', borderTop: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#6b7280', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Low Stock Settings
            </div>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
              Low Stock Threshold
              <span style={{ fontSize: '11px', fontWeight: 400, color: '#6b7280', marginLeft: '6px' }}>alert &amp; vendor email fires when qty drops below this</span>
            </label>
            <input
              type="number"
              name="threshold"
              min="1"
              max="10000"
              placeholder="e.g. 5"
              value={formData.threshold}
              onChange={handleChange}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ccc',
                borderRadius: '6px',
                marginTop: '5px',
                fontSize: '14px',
                backgroundColor: 'var(--card)',
                color: 'var(--text-dark)'
              }}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            style={{
              width: '100%',
              background: 'var(--primary)',
              color: 'var(--button-text)',
              padding: '12px',
              borderRadius: '6px',
              border: 'none',
              fontSize: '16px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.7 : 1
            }}
          >
            {isLoading ? 'Adding Product...' : 'Add Product'}
          </button>

          {message.text && (
            <p style={{ marginTop: '10px', fontSize: '14px', color: getMessageColor() }}>
              {message.text}
            </p>
          )}
        </form>
      </div>
    </DashboardLayout>
  );
}
