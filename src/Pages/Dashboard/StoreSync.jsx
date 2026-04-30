import React, { useState, useEffect } from 'react';
import DashboardLayout from '../../Components/DashboardLayout';
import { collection, query, getDocs, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { configureStoreConnection, getStoreConnectionStatus, getSyncQueueStatus, syncAllProducts } from '../../lib/inkandemotion-sync';
import { Settings, Link as LinkIcon, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';

export default function StoreSync() {
  const [storeConfig, setStoreConfig] = useState({
    storeName: 'inkandemotion.store',
    storeUrl: '',
    apiKey: '',
    webhookUrl: ''
  });

  const [connectionStatus, setConnectionStatus] = useState({
    connected: false,
    storeName: null,
    lastSyncAt: null
  });

  const [syncStatus, setSyncStatus] = useState({
    productSyncPending: 0,
    inventorySyncPending: 0,
    orderStatusSyncPending: 0,
    totalPending: 0
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const loadStatus = async () => {
    try {
      const status = await getStoreConnectionStatus();
      setConnectionStatus(status);

      const syncStats = await getSyncQueueStatus();
      setSyncStatus(syncStats);

      setLoading(false);
    } catch (error) {
      console.error('Error loading status:', error);
      setLoading(false);
    }
  };

  const handleConfigChange = (e) => {
    const { name, value } = e.target;
    setStoreConfig(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSaveConnection = async () => {
    if (!storeConfig.storeUrl.trim()) {
      showMessage('Store URL is required', 'error');
      return;
    }

    setSaving(true);
    try {
      const configRef = doc(db, 'storeSyncConfig', 'config');
      await setDoc(configRef, {
        ...storeConfig,
        status: 'connected',
        lastSyncAt: serverTimestamp(),
        configuredBy: auth.currentUser?.email,
        configuredAt: serverTimestamp()
      }, { merge: true });

      showMessage('Store connection configured successfully!', 'success');
      loadStatus();
    } catch (error) {
      console.error('Error saving config:', error);
      showMessage('Error saving configuration: ' + error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncAllProducts = async () => {
    if (!connectionStatus.connected) {
      showMessage('Please connect to store first', 'warning');
      return;
    }

    setSyncing(true);
    try {
      const result = await syncAllProducts();
      showMessage(`Successfully queued ${result.syncedCount} products for sync!`, 'success');
      setTimeout(loadStatus, 1000);
    } catch (error) {
      console.error('Error syncing products:', error);
      showMessage('Error syncing products: ' + error.message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  const showMessage = (text, type = 'info') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 4000);
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading...</div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto p-6">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Settings className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">Store Integration</h1>
          </div>
          <p className="text-gray-600">Manage InkandEmotion store connection and sync products</p>
        </div>

        {/* Message Alert */}
        {message.text && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.type === 'error' ? 'bg-red-50 text-red-800 border border-red-200' :
            message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' :
            message.type === 'warning' ? 'bg-yellow-50 text-yellow-800 border border-yellow-200' :
            'bg-blue-50 text-blue-800 border border-blue-200'
          }`}>
            {message.text}
          </div>
        )}

        {/* Connection Status Card */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Connection Status</h2>
              <div className="flex items-center gap-2">
                {connectionStatus.connected ? (
                  <>
                    <CheckCircle className="w-5 h-5 text-green-600" />
                    <span className="text-green-700 font-medium">Connected</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-5 h-5 text-yellow-600" />
                    <span className="text-yellow-700 font-medium">Not Connected</span>
                  </>
                )}
              </div>
            </div>
            {connectionStatus.lastSyncAt && (
              <div className="text-right">
                <div className="text-sm text-gray-600">Last synced</div>
                <div className="text-sm font-medium text-gray-900">
                  {new Date(connectionStatus.lastSyncAt).toLocaleString()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Configuration Form */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Store Configuration</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Store Name
              </label>
              <input
                type="text"
                name="storeName"
                value={storeConfig.storeName}
                onChange={handleConfigChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="inkandemotion.store"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Store URL *
              </label>
              <input
                type="url"
                name="storeUrl"
                value={storeConfig.storeUrl}
                onChange={handleConfigChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="https://inkandemotion.com"
              />
              <p className="text-sm text-gray-500 mt-1">The URL of your InkandEmotion store</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                API Key
              </label>
              <input
                type="password"
                name="apiKey"
                value={storeConfig.apiKey}
                onChange={handleConfigChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Your InkandEmotion API key"
              />
              <p className="text-sm text-gray-500 mt-1">Find this in your InkandEmotion settings</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Webhook URL
              </label>
              <input
                type="url"
                name="webhookUrl"
                value={storeConfig.webhookUrl}
                onChange={handleConfigChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="https://inkandemotion.com/webhook"
              />
              <p className="text-sm text-gray-500 mt-1">Where SmartStock will send sync updates</p>
            </div>

            <button
              onClick={handleSaveConnection}
              disabled={saving}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition"
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>

        {/* Sync Actions */}
        {connectionStatus.connected && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Sync Actions</h2>

            <button
              onClick={handleSyncAllProducts}
              disabled={syncing}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition"
            >
              <RefreshCw className="w-4 h-4" />
              {syncing ? 'Syncing Products...' : 'Sync All Products to Store'}
            </button>
            <p className="text-sm text-gray-600 mt-2">
              Queue all products from SmartStock to sync with InkandEmotion
            </p>
          </div>
        )}

        {/* Sync Queue Status */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Sync Queue Status</h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="text-2xl font-bold text-blue-600">{syncStatus.productSyncPending}</div>
              <div className="text-sm text-gray-600">Products Pending</div>
            </div>

            <div className="bg-purple-50 rounded-lg p-4">
              <div className="text-2xl font-bold text-purple-600">{syncStatus.inventorySyncPending}</div>
              <div className="text-sm text-gray-600">Inventory Updates</div>
            </div>

            <div className="bg-orange-50 rounded-lg p-4">
              <div className="text-2xl font-bold text-orange-600">{syncStatus.orderStatusSyncPending}</div>
              <div className="text-sm text-gray-600">Order Status</div>
            </div>

            <div className="bg-green-50 rounded-lg p-4">
              <div className="text-2xl font-bold text-green-600">{syncStatus.totalPending}</div>
              <div className="text-sm text-gray-600">Total Pending</div>
            </div>
          </div>

          <p className="text-sm text-gray-600 mt-4">
            These items are queued and will be synced to InkandEmotion. The status updates automatically every 5 seconds.
          </p>
        </div>

        {/* Info Section */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-2">How it works</h3>
          <ul className="space-y-2 text-blue-800 text-sm">
            <li>✓ <strong>Products:</strong> Add products in SmartStock, they sync automatically to InkandEmotion</li>
            <li>✓ <strong>Inventory:</strong> Stock changes are synced in real-time</li>
            <li>✓ <strong>Orders:</strong> Customers order on InkandEmotion, orders appear in SmartStock automatically</li>
            <li>✓ <strong>Status:</strong> Update order status in SmartStock, it syncs back to InkandEmotion</li>
          </ul>
        </div>
      </div>
    </DashboardLayout>
  );
}
