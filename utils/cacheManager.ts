import { db } from '../firebase';
import { collection, doc, getDoc, setDoc, deleteDoc, getDocs } from 'firebase/firestore';

/**
 * Represents a cached component equivalent entry
 */
export interface CacheEntry {
  equivalent: string;
  newPartNumber: string;
  confidence: 'exact' | 'spec-based';
  source: 'digikey' | 'mouser';
  sourceUrl: string;
}

/**
 * Internal structure of cached data in Firestore
 */
interface FirestoreCacheEntry extends CacheEntry {
  cachedAt: Date;
  manufacturer: string;
  partNumber: string;
}

// TTL: 30 days in milliseconds
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Normalizes manufacturer and part number for use as cache key
 * Converts to lowercase, trims whitespace, and replaces spaces with underscores
 * @param manufacturer - The component manufacturer
 * @param partNumber - The component part number
 * @returns Normalized cache key
 */
function normalizeKey(manufacturer: string, partNumber: string): string {
  const normalizedMfg = manufacturer
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_'); // Replace one or more spaces with single underscore

  const normalizedPart = partNumber
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_');

  return `${normalizedMfg}__${normalizedPart}`;
}

/**
 * Retrieves a cached equivalent from Firestore
 * Returns null if not found, expired, or on error
 * Automatically deletes expired entries
 *
 * @param manufacturer - The component manufacturer
 * @param partNumber - The component part number
 * @returns Promise<CacheEntry | null> - The cached entry or null
 */
export async function getCachedEquivalent(
  manufacturer: string,
  partNumber: string
): Promise<CacheEntry | null> {
  try {
    const key = normalizeKey(manufacturer, partNumber);
    const cacheCollection = collection(db, 'componentCache');
    const docRef = doc(cacheCollection, key);

    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return null;
    }

    const data = docSnap.data() as FirestoreCacheEntry;

    // Check if entry has expired (older than 30 days)
    const cachedAtMs = data.cachedAt?.toMillis?.() || 0;
    const ageMs = Date.now() - cachedAtMs;

    if (ageMs > CACHE_TTL_MS) {
      // Delete expired entry
      try {
        await deleteDoc(docRef);
      } catch (deleteError) {
        console.error('Failed to delete expired cache entry:', deleteError);
        // Continue and return null anyway
      }
      return null;
    }

    // Return only the CacheEntry fields (exclude metadata)
    const { cachedAt, manufacturer: _mfg, partNumber: _part, ...entry } = data;
    return entry as CacheEntry;
  } catch (error) {
    console.error('Error retrieving from cache:', error);
    return null;
  }
}

/**
 * Stores a cache entry in Firestore
 * Includes metadata like cachedAt timestamp and normalized search fields
 * Handles errors gracefully without throwing
 *
 * @param manufacturer - The component manufacturer
 * @param partNumber - The component part number
 * @param entry - The cache entry to store
 * @returns Promise<void>
 */
export async function setCachedEquivalent(
  manufacturer: string,
  partNumber: string,
  entry: CacheEntry
): Promise<void> {
  try {
    const key = normalizeKey(manufacturer, partNumber);
    const cacheCollection = collection(db, 'componentCache');
    const docRef = doc(cacheCollection, key);

    const firestoreEntry: FirestoreCacheEntry = {
      ...entry,
      cachedAt: new Date(),
      manufacturer: manufacturer.toLowerCase().trim(),
      partNumber: partNumber.toLowerCase().trim()
    };

    await setDoc(docRef, firestoreEntry);
  } catch (error) {
    console.error('Error storing in cache:', error);
    // Wrap errors but don't throw - cache failures should not crash the app
  }
}

/**
 * Clears all entries from the component cache
 * Used for testing and manual cache clearing
 * Handles errors gracefully without throwing
 *
 * @returns Promise<void>
 */
export async function clearCache(): Promise<void> {
  try {
    const cacheCollection = collection(db, 'componentCache');
    const snapshot = await getDocs(cacheCollection);

    // Delete all documents
    const deletePromises = snapshot.docs.map((docSnap) => {
      const docRef = doc(cacheCollection, docSnap.ref.id);
      return deleteDoc(docRef).catch((error) => {
        console.error(`Failed to delete cache document ${docSnap.ref.id}:`, error);
      });
    });

    await Promise.all(deletePromises);
  } catch (error) {
    console.error('Error clearing cache:', error);
    // Wrap errors but don't throw - cache failures should not crash the app
  }
}
