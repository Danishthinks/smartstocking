// Firebase configuration
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getMessaging, isSupported } from 'firebase/messaging';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyAvdQCbDjsHd8U3fgZ0vEuxBj_kQDX8CEo",
  authDomain: "smartstock-ffa43.firebaseapp.com",
  projectId: "smartstock-ffa43",
  storageBucket: "smartstock-ffa43.firebasestorage.app",
  messagingSenderId: "452783586843",
  appId: "1:452783586843:web:165f915802ff3203fc82be",
  measurementId: "G-C1KPTCKGV5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);

export const getFirebaseMessaging = async () => {
  const supported = await isSupported();
  if (!supported) return null;
  return getMessaging(app);
};

export default app;
