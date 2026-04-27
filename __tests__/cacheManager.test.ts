import { getCachedEquivalent, setCachedEquivalent, clearCache, CacheEntry } from '@/utils/cacheManager';
import { db } from '@/firebase';
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore';

// Mock Firebase Firestore
jest.mock('@/firebase', () => ({
  db: 'mock-db'
}));

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  setDoc: jest.fn(),
  deleteDoc: jest.fn(),
  getDocs: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  serverTimestamp: jest.fn(() => ({
    toMillis: jest.fn(() => Date.now())
  })),
  Timestamp: {
    now: jest.fn(() => ({
      toMillis: jest.fn(() => Date.now())
    }))
  }
}));

describe('Cache Manager', () => {
  let mockGetDoc: jest.Mock;
  let mockSetDoc: jest.Mock;
  let mockDeleteDoc: jest.Mock;
  let mockGetDocs: jest.Mock;
  let mockCollection: jest.Mock;
  let mockDoc: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup Firebase mock functions
    const firebaseModule = require('firebase/firestore');
    mockGetDoc = firebaseModule.getDoc;
    mockSetDoc = firebaseModule.setDoc;
    mockDeleteDoc = firebaseModule.deleteDoc;
    mockGetDocs = firebaseModule.getDocs;
    mockCollection = firebaseModule.collection;
    mockDoc = firebaseModule.doc;

    // Default mock implementations
    mockGetDoc.mockResolvedValue({ exists: () => false });
    mockSetDoc.mockResolvedValue(undefined);
    mockDeleteDoc.mockResolvedValue(undefined);
    mockGetDocs.mockResolvedValue({ docs: [] });
    mockCollection.mockReturnValue('mock-collection');
    mockDoc.mockReturnValue({
      id: 'mock-doc-id',
      path: 'componentCache/mock-doc-id'
    });
  });

  describe('getCachedEquivalent', () => {
    it('should return null on cache miss', async () => {
      mockGetDoc.mockResolvedValue({ exists: () => false });

      const result = await getCachedEquivalent('Texas Instruments', 'LM358');

      expect(result).toBeNull();
    });

    it('should return cached entry on cache hit', async () => {
      const mockEntry: CacheEntry = {
        equivalent: 'LM358N',
        newPartNumber: '12345678',
        confidence: 'exact',
        source: 'digikey',
        sourceUrl: 'https://www.digikey.com/product-detail/12345678'
      };

      mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({
          ...mockEntry,
          cachedAt: {
            toMillis: () => Date.now()
          },
          manufacturer: 'Texas Instruments',
          partNumber: 'LM358'
        })
      });

      const result = await getCachedEquivalent('Texas Instruments', 'LM358');

      expect(result).toEqual(mockEntry);
    });

    it('should normalize whitespace in keys', async () => {
      const mockEntry: CacheEntry = {
        equivalent: 'LM358N',
        newPartNumber: '12345678',
        confidence: 'exact',
        source: 'digikey',
        sourceUrl: 'https://www.digikey.com/product-detail/12345678'
      };

      mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({
          ...mockEntry,
          cachedAt: {
            toMillis: () => Date.now()
          },
          manufacturer: 'Texas Instruments',
          partNumber: 'LM358'
        })
      });

      // Query with extra spaces
      const result = await getCachedEquivalent('  Texas Instruments  ', '  LM358  ');

      expect(result).toEqual(mockEntry);
      // Verify that the normalized key was used
      expect(mockDoc).toHaveBeenCalledWith(
        'mock-collection',
        expect.stringMatching(/texas_instruments.*lm358/)
      );
    });

    it('should return null for expired entries (older than 30 days)', async () => {
      const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

      mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({
          equivalent: 'LM358N',
          newPartNumber: '12345678',
          confidence: 'exact',
          source: 'digikey',
          sourceUrl: 'https://example.com',
          cachedAt: {
            toMillis: () => thirtyOneDaysAgo.getTime()
          },
          manufacturer: 'Texas Instruments',
          partNumber: 'LM358'
        })
      });

      const result = await getCachedEquivalent('Texas Instruments', 'LM358');

      expect(result).toBeNull();
      // Should delete expired entry
      expect(mockDeleteDoc).toHaveBeenCalled();
    });

    it('should return entry that is exactly 30 days old (not expired)', async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const mockEntry: CacheEntry = {
        equivalent: 'LM358N',
        newPartNumber: '12345678',
        confidence: 'exact',
        source: 'digikey',
        sourceUrl: 'https://example.com'
      };

      mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({
          ...mockEntry,
          cachedAt: {
            toMillis: () => thirtyDaysAgo.getTime()
          },
          manufacturer: 'Texas Instruments',
          partNumber: 'LM358'
        })
      });

      const result = await getCachedEquivalent('Texas Instruments', 'LM358');

      // Should still be valid at exactly 30 days (not expired)
      expect(result).toEqual(mockEntry);
      expect(mockDeleteDoc).not.toHaveBeenCalled();
    });

    it('should handle Firestore errors gracefully', async () => {
      mockGetDoc.mockRejectedValue(new Error('Firestore connection failed'));

      const result = await getCachedEquivalent('Texas Instruments', 'LM358');

      expect(result).toBeNull();
    });
  });

  describe('setCachedEquivalent', () => {
    it('should store entry in Firestore', async () => {
      const entry: CacheEntry = {
        equivalent: 'LM358N',
        newPartNumber: '12345678',
        confidence: 'exact',
        source: 'digikey',
        sourceUrl: 'https://www.digikey.com/product-detail/12345678'
      };

      await setCachedEquivalent('Texas Instruments', 'LM358', entry);

      expect(mockSetDoc).toHaveBeenCalled();
    });

    it('should include cachedAt timestamp', async () => {
      const entry: CacheEntry = {
        equivalent: 'LM358N',
        newPartNumber: '12345678',
        confidence: 'exact',
        source: 'digikey',
        sourceUrl: 'https://www.digikey.com/product-detail/12345678'
      };

      await setCachedEquivalent('Texas Instruments', 'LM358', entry);

      const setDocCall = mockSetDoc.mock.calls[0];
      const storedData = setDocCall[1];

      expect(storedData.cachedAt).toBeDefined();
      // serverTimestamp() returns a Firestore Timestamp object with toMillis method
      expect(storedData.cachedAt).toHaveProperty('toMillis');
    });

    it('should include manufacturer and partNumber', async () => {
      const entry: CacheEntry = {
        equivalent: 'LM358N',
        newPartNumber: '12345678',
        confidence: 'exact',
        source: 'digikey',
        sourceUrl: 'https://www.digikey.com/product-detail/12345678'
      };

      await setCachedEquivalent('Texas Instruments', 'LM358', entry);

      const setDocCall = mockSetDoc.mock.calls[0];
      const storedData = setDocCall[1];

      expect(storedData.manufacturer).toBe('texas instruments');
      expect(storedData.partNumber).toBe('lm358');
    });

    it('should normalize whitespace in manufacturer and part number', async () => {
      const entry: CacheEntry = {
        equivalent: 'LM358N',
        newPartNumber: '12345678',
        confidence: 'exact',
        source: 'digikey',
        sourceUrl: 'https://www.digikey.com/product-detail/12345678'
      };

      await setCachedEquivalent('  Texas Instruments  ', '  LM358  ', entry);

      const setDocCall = mockSetDoc.mock.calls[0];
      const storedData = setDocCall[1];

      expect(storedData.manufacturer).toBe('texas instruments');
      expect(storedData.partNumber).toBe('lm358');
    });

    it('should handle errors gracefully without throwing', async () => {
      mockSetDoc.mockRejectedValue(new Error('Firestore write failed'));

      const entry: CacheEntry = {
        equivalent: 'LM358N',
        newPartNumber: '12345678',
        confidence: 'exact',
        source: 'digikey',
        sourceUrl: 'https://www.digikey.com/product-detail/12345678'
      };

      // Should not throw
      await expect(setCachedEquivalent('Texas Instruments', 'LM358', entry)).resolves.not.toThrow();
    });

    it('should store all cache entry fields', async () => {
      const entry: CacheEntry = {
        equivalent: 'LM358N',
        newPartNumber: '12345678',
        confidence: 'spec-based',
        source: 'mouser',
        sourceUrl: 'https://www.mouser.com/product-detail/12345678'
      };

      await setCachedEquivalent('NXP Semiconductors', 'BC847', entry);

      const setDocCall = mockSetDoc.mock.calls[0];
      const storedData = setDocCall[1];

      expect(storedData.equivalent).toBe('LM358N');
      expect(storedData.newPartNumber).toBe('12345678');
      expect(storedData.confidence).toBe('spec-based');
      expect(storedData.source).toBe('mouser');
      expect(storedData.sourceUrl).toBe('https://www.mouser.com/product-detail/12345678');
    });
  });

  describe('clearCache', () => {
    it('should delete all documents in componentCache collection', async () => {
      const mockDocs = [
        { ref: 'doc1' },
        { ref: 'doc2' },
        { ref: 'doc3' }
      ];

      mockGetDocs.mockResolvedValue({
        docs: mockDocs
      });

      mockDoc.mockImplementation((_, ref) => ref);

      await clearCache();

      // Should have been called for each doc
      expect(mockDeleteDoc).toHaveBeenCalledTimes(3);
    });

    it('should handle empty cache gracefully', async () => {
      mockGetDocs.mockResolvedValue({
        docs: []
      });

      // Should not throw
      await expect(clearCache()).resolves.not.toThrow();
      expect(mockDeleteDoc).not.toHaveBeenCalled();
    });

    it('should handle Firestore errors gracefully', async () => {
      mockGetDocs.mockRejectedValue(new Error('Firestore read failed'));

      // Should not throw
      await expect(clearCache()).resolves.not.toThrow();
    });

    it('should log errors but not throw on delete failure', async () => {
      const consoleLogSpy = jest.spyOn(console, 'error').mockImplementation();

      mockGetDocs.mockResolvedValue({
        docs: [{ ref: 'doc1' }]
      });

      mockDoc.mockImplementation((_, ref) => ref);
      mockDeleteDoc.mockRejectedValue(new Error('Delete failed'));

      // Should not throw
      await expect(clearCache()).resolves.not.toThrow();

      consoleLogSpy.mockRestore();
    });
  });

  describe('Key normalization', () => {
    it('should treat different case as same key', async () => {
      mockGetDoc.mockResolvedValue({ exists: () => false });

      await getCachedEquivalent('TEXAS INSTRUMENTS', 'LM358');

      const docCall = mockDoc.mock.calls[0];
      const key = docCall[1];

      // Should be lowercased
      expect(key.toLowerCase()).toBe(key);
    });

    it('should replace spaces with underscores in key', async () => {
      mockGetDoc.mockResolvedValue({ exists: () => false });

      await getCachedEquivalent('Texas Instruments', 'LM358');

      const docCall = mockDoc.mock.calls[0];
      const key = docCall[1];

      // Should have underscores instead of spaces
      expect(key).toContain('texas_instruments');
    });

    it('should handle multiple spaces correctly', async () => {
      mockGetDoc.mockResolvedValue({ exists: () => false });

      await getCachedEquivalent('Texas   Instruments', 'LM358');

      const docCall = mockDoc.mock.calls[0];
      const key = docCall[1];

      // Multiple spaces should become single underscore within manufacturer/part
      expect(key).toContain('texas_instruments');
      // Key should have __ separator between manufacturer and part number
      expect(key).toBe('texas_instruments__lm358');
    });
  });
});
