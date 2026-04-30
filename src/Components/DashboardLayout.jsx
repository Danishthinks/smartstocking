import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../Contexts/AuthContext';
import { signOut } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import ThemeToggle from './ui/ThemeToggle';
import { collection, limit, onSnapshot, query } from 'firebase/firestore';
import { LayoutDashboard, PlusCircle, Package, FileText, Warehouse, Search, X, ShoppingCart, ReceiptText, Settings } from 'lucide-react';

export default function DashboardLayout({ children }) {
  const { currentUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [inventoryProducts, setInventoryProducts] = useState([]);
  const [warehouseNames, setWarehouseNames] = useState([]);
  const searchBoxRef = useRef(null);

  const staticSearchItems = useMemo(
    () => [
      {
        id: 'page-dashboard',
        label: 'Dashboard Overview',
        description: 'KPIs, charts, and stock summary',
        path: '/dashboard',
        type: 'Page',
        keywords: ['dashboard', 'overview', 'analytics', 'summary']
      },
      {
        id: 'page-add-product',
        label: 'Add Product',
        description: 'Create a new inventory product',
        path: '/dashboard/add-product',
        type: 'Page',
        keywords: ['add', 'product', 'create', 'inventory']
      },
      {
        id: 'page-inventory',
        label: 'Inventory List',
        description: 'View and manage all products',
        path: '/dashboard/inventory',
        type: 'Page',
        keywords: ['inventory', 'products', 'stock', 'list']
      },
      {
        id: 'page-warehouses',
        label: 'Warehouse Management',
        description: 'Manage warehouses and transfers',
        path: '/dashboard/warehouses',
        type: 'Page',
        keywords: ['warehouse', 'location', 'transfer']
      },
      {
        id: 'page-pos',
        label: 'Record Sale (POS)',
        description: 'Sell items and checkout transactions',
        path: '/dashboard/pos',
        type: 'Page',
        keywords: ['sale', 'pos', 'checkout', 'transaction']
      },
      {
        id: 'page-sales-history',
        label: 'Sales History',
        description: 'Review past transactions by date or product',
        path: '/dashboard/sales-history',
        type: 'Page',
        keywords: ['sales', 'history', 'transactions', 'orders']
      },
      {
        id: 'page-online-orders',
        label: 'Ecommerce Orders',
        description: 'Manage online store orders and fulfillment',
        path: '/dashboard/orders',
        type: 'Page',
        keywords: ['ecommerce', 'online orders', 'storefront', 'shop']
      },
      {
        id: 'page-logs',
        label: 'Activity Logs',
        description: 'Track product and warehouse actions',
        path: '/dashboard/logs',
        type: 'Page',
        keywords: ['logs', 'activity', 'history', 'audit']
      },
      {
        id: 'page-store-sync',
        label: 'Store Integration',
        description: 'Sync with InkandEmotion store',
        path: '/dashboard/store-sync',
        type: 'Page',
        keywords: ['store', 'sync', 'integration', 'ecommerce', 'products', 'inventory']
      },
      {
        id: 'action-export-inventory',
        label: 'Export Inventory Report',
        description: 'Open inventory to export CSV/PDF',
        path: '/dashboard/inventory',
        type: 'Action',
        keywords: ['export', 'csv', 'pdf', 'inventory report']
      },
      {
        id: 'action-transfer-stock',
        label: 'Transfer Stock',
        description: 'Open warehouses and transfer stock',
        path: '/dashboard/warehouses',
        type: 'Action',
        keywords: ['transfer', 'stock', 'move', 'warehouse']
      },
      {
        id: 'action-record-sale',
        label: 'Checkout Sale',
        description: 'Open POS and complete a sale',
        path: '/dashboard/pos',
        type: 'Action',
        keywords: ['sale', 'checkout', 'pos', 'payment']
      },
      {
        id: 'action-view-sales',
        label: 'View Sales History',
        description: 'Open transaction history and filters',
        path: '/dashboard/sales-history',
        type: 'Action',
        keywords: ['sales', 'history', 'transactions', 'report']
      },
      {
        id: 'action-manage-online-orders',
        label: 'Manage Ecommerce Orders',
        description: 'Open online order queue and update fulfillment',
        path: '/dashboard/orders',
        type: 'Action',
        keywords: ['orders', 'ecommerce', 'online', 'fulfillment']
      }
    ],
    []
  );

  useEffect(() => {
    if (!db) return;

    const productsQuery = query(collection(db, 'products'), limit(40));
    const warehousesQuery = query(collection(db, 'warehouses'), limit(30));

    const unsubProducts = onSnapshot(
      productsQuery,
      (snapshot) => {
        const names = [];
        snapshot.forEach((document) => {
          const product = document.data();
          if (product?.name) {
            names.push(String(product.name));
          }
        });
        setInventoryProducts(Array.from(new Set(names)).slice(0, 25));
      },
      () => setInventoryProducts([])
    );

    const unsubWarehouses = onSnapshot(
      warehousesQuery,
      (snapshot) => {
        const names = [];
        snapshot.forEach((document) => {
          const warehouse = document.data();
          if (warehouse?.name) {
            names.push(String(warehouse.name));
          }
        });
        setWarehouseNames(Array.from(new Set(names)).slice(0, 20));
      },
      () => setWarehouseNames([])
    );

    return () => {
      unsubProducts();
      unsubWarehouses();
    };
  }, []);

  useEffect(() => {
    const onDocumentClick = (event) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target)) {
        setSearchOpen(false);
        setHighlightIndex(-1);
      }
    };

    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, []);

  const dynamicSearchItems = useMemo(() => {
    const products = inventoryProducts.map((name, index) => ({
      id: `product-${index}-${name}`,
      label: name,
      description: 'Open in Inventory List',
      path: '/dashboard/inventory',
      type: 'Product',
      queryValue: name,
      keywords: ['product', 'inventory', name]
    }));

    const warehouses = warehouseNames.map((name, index) => ({
      id: `warehouse-${index}-${name}`,
      label: name,
      description: 'Open in Warehouse Management',
      path: '/dashboard/warehouses',
      type: 'Warehouse',
      queryValue: name,
      keywords: ['warehouse', 'location', name]
    }));

    return [...products, ...warehouses];
  }, [inventoryProducts, warehouseNames]);

  const allSearchItems = useMemo(
    () => [...staticSearchItems, ...dynamicSearchItems],
    [staticSearchItems, dynamicSearchItems]
  );

  const filteredSearchItems = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();

    if (!keyword) {
      return allSearchItems.slice(0, 8);
    }

    return allSearchItems
      .filter((item) => {
        const haystack = [item.label, item.description, item.type, ...(item.keywords || [])]
          .join(' ')
          .toLowerCase();
        return haystack.includes(keyword);
      })
      .slice(0, 10);
  }, [searchTerm, allSearchItems]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const isActive = (path) => location.pathname === path;

  const runSearchNavigation = (item) => {
    if (!item?.path) return;

    if (item.queryValue) {
      navigate(`${item.path}?q=${encodeURIComponent(item.queryValue)}`);
    } else {
      navigate(item.path);
    }

    setSearchTerm('');
    setSearchOpen(false);
    setHighlightIndex(-1);
  };

  const handleSearchKeyDown = (event) => {
    if (!filteredSearchItems.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSearchOpen(true);
      setHighlightIndex((current) =>
        current >= filteredSearchItems.length - 1 ? 0 : current + 1
      );
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSearchOpen(true);
      setHighlightIndex((current) =>
        current <= 0 ? filteredSearchItems.length - 1 : current - 1
      );
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const selected =
        highlightIndex >= 0 ? filteredSearchItems[highlightIndex] : filteredSearchItems[0];
      runSearchNavigation(selected);
    }

    if (event.key === 'Escape') {
      setSearchOpen(false);
      setHighlightIndex(-1);
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      {/* Sidebar */}
      <div
        style={{
          width: '230px',
          backgroundColor: 'var(--sidebar)',
          color: '#fff',
          height: '100vh',
          position: 'fixed',
          padding: '25px 15px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}
      >
        <div
          style={{
            fontSize: '22px',
            fontWeight: 600,
            marginBottom: '25px',
            textAlign: 'center'
          }}
        >
          SMARTSTOCK
        </div>

        <Link
          to="/dashboard"
          className="nav-link"
          style={{
            padding: '12px',
            borderRadius: '8px',
            color: isActive('/dashboard') ? '#fff' : '#d1d5db',
            textDecoration: 'none',
            fontSize: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            transition: '0.2s',
            backgroundColor: isActive('/dashboard') ? 'rgba(255,255,255,0.12)' : 'transparent'
          }}
          onMouseEnter={(e) => {
            if (!isActive('/dashboard')) {
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.transform = 'translateX(3px)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isActive('/dashboard')) {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#d1d5db';
              e.currentTarget.style.transform = 'translateX(0)';
            }
          }}
        >
          <LayoutDashboard size={18} />
          Dashboard
        </Link>

        <Link
          to="/dashboard/add-product"
          className="nav-link"
          style={{
            padding: '12px',
            borderRadius: '8px',
            color: isActive('/dashboard/add-product') ? '#fff' : '#d1d5db',
            textDecoration: 'none',
            fontSize: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            transition: '0.2s',
            backgroundColor: isActive('/dashboard/add-product') ? 'rgba(255,255,255,0.12)' : 'transparent'
          }}
          onMouseEnter={(e) => {
            if (!isActive('/dashboard/add-product')) {
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.transform = 'translateX(3px)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isActive('/dashboard/add-product')) {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#d1d5db';
              e.currentTarget.style.transform = 'translateX(0)';
            }
          }}
        >
          <PlusCircle size={18} />
          Add Product
        </Link>

        <Link
          to="/dashboard/inventory"
          className="nav-link"
          style={{
            padding: '12px',
            borderRadius: '8px',
            color: isActive('/dashboard/inventory') ? '#fff' : '#d1d5db',
            textDecoration: 'none',
            fontSize: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            transition: '0.2s',
            backgroundColor: isActive('/dashboard/inventory') ? 'rgba(255,255,255,0.12)' : 'transparent'
          }}
          onMouseEnter={(e) => {
            if (!isActive('/dashboard/inventory')) {
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.transform = 'translateX(3px)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isActive('/dashboard/inventory')) {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#d1d5db';
              e.currentTarget.style.transform = 'translateX(0)';
            }
          }}
        >
          <Package size={18} />
          Inventory List
        </Link>

        <Link
          to="/dashboard/warehouses"
          className="nav-link"
          style={{
            padding: '12px',
            borderRadius: '8px',
            color: isActive('/dashboard/warehouses') ? '#fff' : '#d1d5db',
            textDecoration: 'none',
            fontSize: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            transition: '0.2s',
            backgroundColor: isActive('/dashboard/warehouses') ? 'rgba(255,255,255,0.12)' : 'transparent'
          }}
          onMouseEnter={(e) => {
            if (!isActive('/dashboard/warehouses')) {
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.transform = 'translateX(3px)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isActive('/dashboard/warehouses')) {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#d1d5db';
              e.currentTarget.style.transform = 'translateX(0)';
            }
          }}
        >
          <Warehouse size={18} />
          Warehouses
        </Link>

        <Link
          to="/dashboard/pos"
          className="nav-link"
          style={{
            padding: '12px',
            borderRadius: '8px',
            color: isActive('/dashboard/pos') ? '#fff' : '#d1d5db',
            textDecoration: 'none',
            fontSize: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            transition: '0.2s',
            backgroundColor: isActive('/dashboard/pos') ? 'rgba(255,255,255,0.12)' : 'transparent'
          }}
          onMouseEnter={(e) => {
            if (!isActive('/dashboard/pos')) {
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.transform = 'translateX(3px)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isActive('/dashboard/pos')) {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#d1d5db';
              e.currentTarget.style.transform = 'translateX(0)';
            }
          }}
        >
          <ShoppingCart size={18} />
          Record Sale
        </Link>

        <Link
          to="/dashboard/logs"
          className="nav-link"
          style={{
            padding: '12px',
            borderRadius: '8px',
            color: isActive('/dashboard/logs') ? '#fff' : '#d1d5db',
            textDecoration: 'none',
            fontSize: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            transition: '0.2s',
            backgroundColor: isActive('/dashboard/logs') ? 'rgba(255,255,255,0.12)' : 'transparent'
          }}
          onMouseEnter={(e) => {
            if (!isActive('/dashboard/logs')) {
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.transform = 'translateX(3px)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isActive('/dashboard/logs')) {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#d1d5db';
              e.currentTarget.style.transform = 'translateX(0)';
            }
          }}
        >
          <FileText size={18} />
          Activity Logs
        </Link>

        <Link
          to="/dashboard/sales-history"
          className="nav-link"
          style={{
            padding: '12px',
            borderRadius: '8px',
            color: isActive('/dashboard/sales-history') ? '#fff' : '#d1d5db',
            textDecoration: 'none',
            fontSize: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            transition: '0.2s',
            backgroundColor: isActive('/dashboard/sales-history') ? 'rgba(255,255,255,0.12)' : 'transparent'
          }}
          onMouseEnter={(e) => {
            if (!isActive('/dashboard/sales-history')) {
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.transform = 'translateX(3px)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isActive('/dashboard/sales-history')) {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#d1d5db';
              e.currentTarget.style.transform = 'translateX(0)';
            }
          }}
        >
          <ReceiptText size={18} />
          Sales History
        </Link>

        <Link
          to="/dashboard/orders"
          className="nav-link"
          style={{
            padding: '12px',
            borderRadius: '8px',
            color: isActive('/dashboard/orders') ? '#fff' : '#d1d5db',
            textDecoration: 'none',
            fontSize: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            transition: '0.2s',
            backgroundColor: isActive('/dashboard/orders') ? 'rgba(255,255,255,0.12)' : 'transparent'
          }}
          onMouseEnter={(e) => {
            if (!isActive('/dashboard/orders')) {
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.transform = 'translateX(3px)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isActive('/dashboard/orders')) {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#d1d5db';
              e.currentTarget.style.transform = 'translateX(0)';
            }
          }}
        >
          <ShoppingCart size={18} />
          Ecommerce Orders
        </Link>

        <Link
          to="/dashboard/store-sync"
          className="nav-link"
          style={{
            padding: '12px',
            borderRadius: '8px',
            color: isActive('/dashboard/store-sync') ? '#fff' : '#d1d5db',
            textDecoration: 'none',
            fontSize: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            transition: '0.2s',
            backgroundColor: isActive('/dashboard/store-sync') ? 'rgba(255,255,255,0.12)' : 'transparent'
          }}
          onMouseEnter={(e) => {
            if (!isActive('/dashboard/store-sync')) {
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.transform = 'translateX(3px)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isActive('/dashboard/store-sync')) {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#d1d5db';
              e.currentTarget.style.transform = 'translateX(0)';
            }
          }}
        >
          <Settings size={18} />
          Store Sync
        </Link>

        {/* User info and logout */}
        <div
          style={{
            marginTop: 'auto',
            padding: '15px',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            fontSize: '14px',
            color: '#d1d5db'
          }}
        >
          <div>{currentUser?.email || 'Loading...'}</div>
          <div
            style={{
              display: 'flex',
              gap: '8px',
              flexDirection: 'column',
              marginTop: '8px'
            }}
          >
            <div style={{ width: '100%' }}>
              <ThemeToggle
                id="themeToggleBtn"
                style={{
                  color: '#d1d5db',
                  padding: '5px 0',
                  fontSize: '14px',
                  textAlign: 'left',
                  width: '100%',
                  justifyContent: 'flex-start'
                }}
              />
            </div>
            <button
              onClick={handleLogout}
              style={{
                background: 'none',
                border: 'none',
                color: '#d1d5db',
                padding: '5px 0',
                cursor: 'pointer',
                fontSize: '14px',
                textAlign: 'left',
                width: '100%'
              }}
              onMouseEnter={(e) => {
                e.target.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.target.style.color = '#d1d5db';
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div
        style={{
          marginLeft: '230px',
          padding: '20px 30px 30px',
          width: '100%'
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '18px',
            gap: '16px',
            flexWrap: 'wrap'
          }}
        >
          <div
            style={{
              fontSize: '16px',
              color: 'var(--text-dark)',
              fontWeight: 600
            }}
          >
            Smartstock Management
          </div>

          <div
            ref={searchBoxRef}
            style={{
              position: 'relative',
              width: 'min(640px, 100%)',
              flex: '1 1 420px'
            }}
          >
            <Search
              size={16}
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#6b7280'
              }}
            />

            <input
              type="text"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setSearchOpen(true);
                setHighlightIndex(-1);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search pages, products, warehouses, or actions..."
              aria-label="Global management search"
              style={{
                width: '100%',
                backgroundColor: 'var(--card)',
                color: 'var(--text-dark)',
                border: '1px solid #d1d5db',
                borderRadius: '10px',
                padding: '12px 42px 12px 36px',
                fontSize: '14px',
                outline: 'none',
                boxShadow: '0 1px 6px rgba(15, 23, 42, 0.08)'
              }}
            />

            {searchTerm && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setSearchOpen(true);
                  setHighlightIndex(-1);
                }}
                aria-label="Clear search"
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: '#6b7280',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <X size={16} />
              </button>
            )}

            {searchOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  right: 0,
                  background: 'var(--card)',
                  border: '1px solid #d1d5db',
                  borderRadius: '10px',
                  boxShadow: '0 12px 30px rgba(2, 6, 23, 0.15)',
                  maxHeight: '340px',
                  overflowY: 'auto',
                  zIndex: 50
                }}
              >
                {filteredSearchItems.length === 0 ? (
                  <div
                    style={{
                      padding: '12px 14px',
                      fontSize: '13px',
                      color: '#6b7280'
                    }}
                  >
                    No matching results. Try product names, warehouses, or pages.
                  </div>
                ) : (
                  filteredSearchItems.map((item, index) => (
                    <button
                      key={item.id}
                      onClick={() => runSearchNavigation(item)}
                      style={{
                        width: '100%',
                        border: 'none',
                        background: highlightIndex === index ? '#eef2ff' : 'transparent',
                        padding: '10px 12px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        borderBottom:
                          index === filteredSearchItems.length - 1 ? 'none' : '1px solid #f1f5f9'
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: '8px',
                          alignItems: 'center'
                        }}
                      >
                        <div style={{ fontSize: '14px', color: 'var(--text-dark)', fontWeight: 600 }}>
                          {item.label}
                        </div>
                        <span
                          style={{
                            fontSize: '11px',
                            color: '#475569',
                            background: '#e2e8f0',
                            borderRadius: '999px',
                            padding: '2px 8px'
                          }}
                        >
                          {item.type}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                        {item.description}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}
