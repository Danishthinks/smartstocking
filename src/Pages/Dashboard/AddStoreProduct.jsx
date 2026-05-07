import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../../Components/DashboardLayout';
import { collection, addDoc, serverTimestamp, onSnapshot, query } from 'firebase/firestore';
import { db, auth, storage } from '../../lib/firebase';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { addLog } from '../../lib/firebase-logs';
import { pushNotification, sendCrudNotification } from '../../lib/notifications';

export default function AddStoreProduct() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    productId: '',
    name: '',
    category: '',
    imageUrl: '',
    sellingPrice: '',
    quantity: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [categories, setCategories] = useState([]);
  const [uploadedImages, setUploadedImages] = useState([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);

  const round2 = (num) => Math.round(Number(num || 0) * 100) / 100;

  useEffect(() => {
    // Fetch existing categories from store products
    if (!db) return;

    const productsQuery = query(collection(db, 'products'));
    const unsubscribe = onSnapshot(
      productsQuery,
      (snapshot) => {
        const cats = new Set();
        snapshot.forEach((doc) => {
          const cat = doc.data().category;
          if (cat) cats.add(cat);
        });
        setCategories(Array.from(cats).sort());
      },
      (error) => {
        console.error('Error loading categories:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleSelectImages = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';

    if (files.length === 0) return;

    const newImages = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      url: null,
      uploading: false,
      uploadProgress: 0,
      error: null
    }));

    setUploadedImages((prev) => [...prev, ...newImages]);
  };

  const uploadProductImages = async () => {
    if (uploadedImages.length === 0) {
      showMessage('Please select images first', 'warning');
      return;
    }

    const pendingImages = uploadedImages.filter((img) => !img.url && !img.uploading);
    if (pendingImages.length === 0) {
      showMessage('All images have been uploaded', 'info');
      return;
    }

    setIsUploadingImages(true);

    const uploadPromises = pendingImages.map((imageData, index) => {
      return new Promise((resolve) => {
        const file = imageData.file;
        const timestamp = Date.now();
        const fileName = `${timestamp}-${index}-${file.name}`;
        const storageRef = ref(storage, `product-images/${fileName}`);

        const uploadTask = uploadBytesResumable(storageRef, file);

        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            setUploadedImages((prev) =>
              prev.map((img) =>
                img.file === file
                  ? { ...img, uploading: true, uploadProgress: progress }
                  : img
              )
            );
          },
          (error) => {
            console.error('Image upload error:', error);
            setUploadedImages((prev) =>
              prev.map((img) =>
                img.file === file
                  ? { ...img, uploading: false, error: error.message }
                  : img
              )
            );
            showMessage(`Failed to upload ${file.name}`, 'error');
            resolve();
          },
          async () => {
            try {
              const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
              setUploadedImages((prev) =>
                prev.map((img) =>
                  img.file === file
                    ? { ...img, url: downloadUrl, uploading: false }
                    : img
                )
              );
            } catch (error) {
              console.error('Failed to get download URL:', error);
              setUploadedImages((prev) =>
                prev.map((img) =>
                  img.file === file
                    ? { ...img, uploading: false, error: 'Failed to get URL' }
                    : img
                )
              );
            }
            resolve();
          }
        );
      });
    });

    await Promise.all(uploadPromises);
    setIsUploadingImages(false);
    showMessage('Images uploaded successfully!', 'success');
  };

  const removeImage = async (imageData) => {
    if (imageData.url) {
      try {
        const fileRef = ref(storage, imageData.url);
        await deleteObject(fileRef);
      } catch (error) {
        console.error('Error deleting image:', error);
      }
    }
    URL.revokeObjectURL(imageData.preview);
    setUploadedImages((prev) => prev.filter((img) => img !== imageData));
  };

  const showMessage = (text, type = 'error') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 5000);
  };

  const handleChange = (e) => {
    setFormData((previous) => {
      return {
        ...previous,
        [e.target.name]: e.target.value
      };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });

    const { productId, name, category, sellingPrice, quantity } = formData;

    // Check if there are pending image uploads
    const hasPendingUploads = uploadedImages.some((img) => !img.url && !img.error);
    if (hasPendingUploads) {
      showMessage('⚠️ Please wait for all images to finish uploading, or remove pending images.', 'warning');
      return;
    }

    // Validate inputs
    if (!name.trim() || !category.trim() || !sellingPrice || !quantity) {
      showMessage('⚠️ Please fill all required fields', 'warning');
      return;
    }

    const sellNum = round2(sellingPrice);
    const qtyNum = Number(quantity);

    if (sellNum <= 0) {
      showMessage('⚠️ Selling price must be greater than 0', 'warning');
      return;
    }

    if (qtyNum < 0 || !Number.isInteger(qtyNum)) {
      showMessage('⚠️ Quantity must be a positive whole number', 'warning');
      return;
    }

    if (!db) {
      showMessage('❌ Database not initialized. Please refresh the page.', 'error');
      return;
    }

    setIsLoading(true);
    showMessage('Adding product to store...', 'warning');

    try {
      // Get uploaded image URLs or use form imageUrl or placeholder
      const uploadedImageUrls = uploadedImages
        .filter((img) => img.url)
        .map((img) => img.url);

      let storefrontImageUrl = String(formData.imageUrl || '').trim();
      if (!storefrontImageUrl && uploadedImageUrls.length > 0) {
        storefrontImageUrl = uploadedImageUrls[0];
      }
      if (!storefrontImageUrl) {
        storefrontImageUrl = `https://placehold.co/800x600?text=${encodeURIComponent(name.trim())}`;
      }

      const normalizedProductId = String(productId || '').trim() || `STORE-${Date.now()}`;

      const productPayload = {
        productId: normalizedProductId,
        name: name.trim(),
        category: category.trim(),
        imageUrl: storefrontImageUrl,
        images: uploadedImageUrls.length > 0 ? uploadedImageUrls : [],
        sellingPrice: sellNum,
        quantity: qtyNum,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser.uid,
        source: 'inkandemotion.store',
        showOnStore: true
      };

      await addDoc(collection(db, 'products'), productPayload);

      // Log the action
      addLog('ADD STORE PRODUCT', name.trim(), qtyNum);
      pushNotification('Store product added', {
        body: `${name.trim()} (Qty: ${qtyNum}) was added to store.`
      });
      sendCrudNotification({
        title: 'Store product added',
        body: `${name.trim()} (Qty: ${qtyNum}) was added to store.`
      });

      showMessage('✅ Product Added to Store Successfully', 'success');

      // Reset form
      setFormData({
        productId: '',
        name: '',
        category: '',
        imageUrl: '',
        sellingPrice: '',
        quantity: ''
      });
      // Clear uploaded images
      uploadedImages.forEach((img) => URL.revokeObjectURL(img.preview));
      setUploadedImages([]);
    } catch (err) {
      console.error('Error adding store product:', err);
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
        Add Store Product (InkandEmotion)
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
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
              Product ID (Optional)
            </label>
            <input
              type="text"
              name="productId"
              placeholder="Auto-generated if left blank"
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
              Product Name *
            </label>
            <input
              type="text"
              name="name"
              placeholder="e.g. Handmade Sketch"
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
              required
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
              Category *
            </label>
            <select
              name="category"
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
              required
            >
              <option value="">Select Category</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
              <option value="NEW">+ Add New Category</option>
            </select>
            {formData.category === 'NEW' && (
              <input
                type="text"
                placeholder="Enter new category name"
                onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ccc',
                  borderRadius: '6px',
                  marginTop: '8px',
                  fontSize: '14px',
                  backgroundColor: 'var(--card)',
                  color: 'var(--text-dark)'
                }}
              />
            )}
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
              Gallery Image URL
            </label>
            <input
              type="url"
              name="imageUrl"
              placeholder="Optional image URL"
              maxLength="300"
              value={formData.imageUrl}
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
              📸 Product Images (Multiple)
            </label>
            <small style={{ color: '#64748b', display: 'block', marginBottom: '8px' }}>
              Upload multiple product images to be displayed in the gallery.
            </small>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
              <input
                id="product-images-input"
                type="file"
                multiple
                accept="image/*"
                onChange={handleSelectImages}
                disabled={isLoading || isUploadingImages}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                onClick={() => document.getElementById('product-images-input')?.click()}
                disabled={isLoading || isUploadingImages}
                style={{
                  padding: '10px 14px',
                  borderRadius: '6px',
                  border: '2px solid #3b82f6',
                  background: '#fff',
                  color: '#3b82f6',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isLoading || isUploadingImages ? 'not-allowed' : 'pointer',
                  opacity: isLoading || isUploadingImages ? 0.65 : 1,
                  transition: 'all 0.2s'
                }}
              >
                📁 Select Images
              </button>
              {uploadedImages.some((img) => !img.url && !img.uploading) && (
                <button
                  type="button"
                  onClick={uploadProductImages}
                  disabled={isLoading || isUploadingImages}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: isLoading || isUploadingImages ? 'not-allowed' : 'pointer',
                    opacity: isLoading || isUploadingImages ? 0.65 : 1,
                    transition: 'all 0.2s'
                  }}
                >
                  {isUploadingImages ? '⏳ Uploading...' : '☁️ Upload to Cloud'}
                </button>
              )}
            </div>

            {uploadedImages.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                  gap: '8px',
                  marginTop: '8px',
                  padding: '8px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  background: '#f8fafc'
                }}
              >
                {uploadedImages.map((imgData, idx) => (
                  <div
                    key={idx}
                    style={{
                      position: 'relative',
                      aspectRatio: '1',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      background: '#fff',
                      border: '1px solid #e2e8f0'
                    }}
                  >
                    <img
                      src={imgData.preview}
                      alt={`Preview ${idx}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    {imgData.uploading && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          background: 'rgba(0, 0, 0, 0.6)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontSize: '12px',
                          fontWeight: 600
                        }}
                      >
                        {Math.round(imgData.uploadProgress)}%
                      </div>
                    )}
                    {imgData.url && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '4px',
                          right: '4px',
                          background: '#10b981',
                          color: '#fff',
                          borderRadius: '50%',
                          width: '20px',
                          height: '20px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '12px',
                          fontWeight: 700
                        }}
                      >
                        ✓
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeImage(imgData)}
                      disabled={isLoading || isUploadingImages}
                      style={{
                        position: 'absolute',
                        bottom: '4px',
                        left: '4px',
                        background: 'rgba(0, 0, 0, 0.7)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '50%',
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '14px',
                        cursor: isLoading || isUploadingImages ? 'not-allowed' : 'pointer',
                        opacity: isLoading || isUploadingImages ? 0.5 : 0.8,
                        transition: 'opacity 0.2s'
                      }}
                      title="Remove image"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
              Selling Price (PKR) *
            </label>
            <input
              type="number"
              name="sellingPrice"
              placeholder="e.g. 5000"
              min="0"
              step="0.01"
              value={formData.sellingPrice}
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
              required
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '5px' }}>
              Stock Quantity *
            </label>
            <input
              type="number"
              name="quantity"
              placeholder="e.g. 5"
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
              required
            />
          </div>

          {message.text && (
            <div
              style={{
                padding: '12px',
                borderRadius: '6px',
                marginBottom: '15px',
                color: message.type === 'success' ? '#0a7b00' : message.type === 'warning' ? '#9B870C' : '#b00020',
                backgroundColor:
                  message.type === 'success'
                    ? '#dcfce7'
                    : message.type === 'warning'
                      ? '#fef08a'
                      : '#fee2e2',
                fontSize: '13px',
                fontWeight: 600
              }}
            >
              {message.text}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || isUploadingImages}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '6px',
              border: 'none',
              background: isLoading || isUploadingImages ? '#cbd5e1' : '#2563eb',
              color: '#fff',
              fontSize: '15px',
              fontWeight: 700,
              cursor: isLoading || isUploadingImages ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s'
            }}
          >
            {isLoading ? '⏳ Adding...' : '✨ Add Store Product'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#fff',
              color: '#0f172a',
              fontSize: '15px',
              fontWeight: 600,
              marginTop: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            Back to Dashboard
          </button>
        </form>
      </div>
    </DashboardLayout>
  );
}
