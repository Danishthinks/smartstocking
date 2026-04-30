import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./Pages/Dashboard/login";
import Register from "./Pages/Dashboard/Register";
import Dashboard from "./Pages/Dashboard/Dashboard";
import AddProduct from "./Pages/Dashboard/AddProduct";
import InventoryList from "./Pages/Dashboard/InventoryList";
import ActivityLogs from "./Pages/Dashboard/ActivityLogs";
import Warehouses from "./Pages/Dashboard/Warehouses";
import POS from "./Pages/Dashboard/POS";
import SalesHistory from "./Pages/Dashboard/SalesHistory";
import EcommerceOrders from "./Pages/Dashboard/OnlineOrders";
import StoreSync from "./Pages/Dashboard/StoreSync";
import ProtectedRoute from "./Components/ProtectedRoute";
import ChatbotWidget from "./Components/ui/ChatbotWidget";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/add-product"
          element={
            <ProtectedRoute>
              <AddProduct />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/inventory"
          element={
            <ProtectedRoute>
              <InventoryList />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/warehouses"
          element={
            <ProtectedRoute>
              <Warehouses />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/pos"
          element={
            <ProtectedRoute>
              <POS />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/sales-history"
          element={
            <ProtectedRoute>
              <SalesHistory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/orders"
          element={
            <ProtectedRoute>
              <EcommerceOrders />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/logs"
          element={
            <ProtectedRoute>
              <ActivityLogs />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/store-sync"
          element={
            <ProtectedRoute>
              <StoreSync />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ChatbotWidget />
    </BrowserRouter>
  );
}

export default App;
