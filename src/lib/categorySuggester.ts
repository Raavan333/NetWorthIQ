/**
 * Intelligent Category Suggestion Engine for NetWorthIQ
 * Suggests accurate transaction categories in real-time based on transaction description/merchant,
 * analyzing both user historical spending patterns and a rich keyword/merchant dictionary.
 */

import { Transaction, SpendCategoryConfig } from '../types';

export interface CategorySuggestion {
  category: string;
  confidence: number; // 0.0 to 1.0
  source: 'history' | 'keyword';
  matchedTerm?: string;
}

// Built-in comprehensive keyword & merchant mappings
const KEYWORD_CATEGORY_RULES: { keywords: string[]; targetCategory: string; priority: number }[] = [
  // 1. Food & Dining
  {
    targetCategory: 'Food & Dining',
    priority: 10,
    keywords: [
      'swiggy', 'zomato', 'starbucks', 'kfc', 'mcdonalds', 'mcdonald', 'burger', 'pizza',
      'cafe', 'coffee', 'tea', 'chai', 'restaurant', 'dining', 'dinner', 'lunch', 'breakfast',
      'bakery', 'bar', 'pub', 'snacks', 'biryani', 'subway', 'domino', 'dominos', 'haldiram',
      'bikanervala', 'food', 'eatery', 'dhaba', 'tiffin', 'mess', 'eatclub', 'canteen', 'chaat',
      'ice cream', 'baskin robbins', 'brewery', 'dineout', 'magicpin', 'barbeque nation'
    ],
  },

  // 2. Groceries
  {
    targetCategory: 'Groceries',
    priority: 10,
    keywords: [
      'grocery', 'groceries', 'supermarket', 'dmart', 'bigbasket', 'blinkit', 'zepto',
      'instamart', 'nature\'s basket', 'milk', 'fruits', 'vegetables', 'veggies', 'bread',
      'provision', 'meat', 'fish', 'eggs', 'organic', 'kirana', 'spencer', 'more retail',
      'reliance fresh', 'dairy', 'ration', 'veggie'
    ],
  },

  // 3. Transport & Fuel
  {
    targetCategory: 'Transport & Fuel',
    priority: 10,
    keywords: [
      'petrol', 'diesel', 'fuel', 'shell', 'hpcl', 'iocl', 'bpcl', 'cng', 'gas station',
      'uber', 'ola', 'rapido', 'cab', 'taxi', 'auto', 'autorickshaw', 'rickshaw', 'metro',
      'bus', 'train', 'irctc', 'railway', 'flight', 'airline', 'indigo', 'vistara', 'air india',
      'spicejet', 'toll', 'fastag', 'parking', 'fare', 'transit', 'ticket', 'travel',
      'car service', 'bike service', 'garage', 'puncture', 'driver'
    ],
  },

  // 4. Shopping
  {
    targetCategory: 'Shopping',
    priority: 8,
    keywords: [
      'amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'zara', 'h&m', 'uniqlo',
      'clothes', 'clothing', 'shoes', 'footwear', 'mall', 'retail', 'electronics',
      'croma', 'reliance digital', 'ikea', 'decathlon', 'pantaloons', 'westside',
      'lifestyle', 'lenskart', 'spectacles', 'apparel', 'dress', 'watch', 'bag',
      'nykaa', 'tira', 'sephora', 'snitch', 't-shirt', 'shirt', 'jeans'
    ],
  },

  // 5. Utilities & Bills
  {
    targetCategory: 'Utilities',
    priority: 9,
    keywords: [
      'electricity', 'power bill', 'bescom', 'tneb', 'bses', 'mahavitaran', 'water bill',
      'gas bill', 'lpg', 'indane', 'bharat gas', 'hp gas', 'cylinder', 'broadband',
      'wifi', 'internet', 'airtel', 'jio', 'vi', 'vodafone', 'recharge', 'dth', 'tata play',
      'utility', 'phone bill', 'postpaid', 'prepaid', 'piped gas', 'cable tv', 'bill'
    ],
  },

  // 6. Healthcare & Medical
  {
    targetCategory: 'Healthcare',
    priority: 9,
    keywords: [
      'apollo', 'pharmeasy', '1mg', 'netmeds', 'pharmacy', 'medical', 'chemist', 'medicine',
      'medicines', 'hospital', 'clinic', 'doctor', 'dentist', 'dental', 'diagnostic',
      'lab', 'surgery', 'tablet', 'syrup', 'prescription', 'health', 'consultation',
      'blood test', 'pathology', 'optician', 'physio', 'therapy'
    ],
  },

  // 7. Entertainment & Leisure
  {
    targetCategory: 'Entertainment',
    priority: 8,
    keywords: [
      'netflix', 'spotify', 'prime video', 'hotstar', 'disney', 'youtube', 'movie', 'cinema',
      'pvr', 'inox', 'cinepolis', 'bookmyshow', 'steam', 'playstation', 'gaming', 'concert',
      'event', 'theatre', 'show', 'amusement', 'wonderla', 'standup', 'subscription'
    ],
  },

  // 8. Housing & Rent
  {
    targetCategory: 'Housing & Rent',
    priority: 9,
    keywords: [
      'rent', 'house rent', 'flat rent', 'maintenance', 'society maintenance',
      'landlord', 'lease', 'pg rent', 'room rent', 'flat deposit', 'maid', 'cook',
      'plumber', 'electrician', 'carpenter'
    ],
  },

  // 9. Education
  {
    targetCategory: 'Education',
    priority: 8,
    keywords: [
      'school', 'college', 'tuition', 'course', 'fees', 'books', 'udemy', 'coursera',
      'exam', 'stationery', 'classes', 'coaching', 'academy', 'degree', 'training',
      'tutor', 'textbook', 'kindergarten'
    ],
  },

  // 10. Personal Care & Fitness
  {
    targetCategory: 'Personal Care',
    priority: 8,
    keywords: [
      'gym', 'cult.fit', 'fitness', 'salon', 'spa', 'haircut', 'massage', 'parlor',
      'grooming', 'workout', 'yoga', 'swimming', 'shave', 'barber', 'manicure'
    ],
  },

  // 11. Investments & Savings
  {
    targetCategory: 'Investments',
    priority: 8,
    keywords: [
      'mutual fund', 'sip', 'stocks', 'zerodha', 'groww', 'angelone', 'upstox',
      'deposit', 'ppf', 'nps', 'gold', 'bullion', 'shares', 'etf', 'crypto'
    ],
  },
];

/**
 * Normalizes a category string to match available user/system categories
 */
function findBestMatchingCategory(
  targetCategoryName: string,
  availableCategories: SpendCategoryConfig[]
): string | null {
  const normTarget = targetCategoryName.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Exact match
  const exact = availableCategories.find(
    (c) => c.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normTarget
  );
  if (exact) return exact.name;

  // Substring / containment match
  const partial = availableCategories.find(
    (c) =>
      c.name.toLowerCase().includes(targetCategoryName.toLowerCase()) ||
      targetCategoryName.toLowerCase().includes(c.name.toLowerCase())
  );
  if (partial) return partial.name;

  return null;
}

/**
 * Suggests the best spend category based on transaction description / reason
 */
export function suggestCategoryFromDescription(
  description: string,
  pastTransactions: Transaction[] = [],
  availableCategories: SpendCategoryConfig[] = []
): CategorySuggestion | null {
  const query = (description || '').trim().toLowerCase();
  if (!query || query.length < 2) return null;

  // 1. Check user historical spending patterns (highest weight)
  if (pastTransactions.length > 0) {
    const historicalCategoryCounts = new Map<string, number>();
    let bestHistoryMatch: { category: string; count: number; exact: boolean } | null = null;

    for (const tx of pastTransactions) {
      if (!tx.reason || !tx.category) continue;
      const txReason = tx.reason.trim().toLowerCase();

      // Check exact match
      if (txReason === query) {
        historicalCategoryCounts.set(tx.category, (historicalCategoryCounts.get(tx.category) || 0) + 3);
      } else if (txReason.includes(query) || query.includes(txReason)) {
        historicalCategoryCounts.set(tx.category, (historicalCategoryCounts.get(tx.category) || 0) + 1);
      }
    }

    if (historicalCategoryCounts.size > 0) {
      // Find category with highest historical frequency
      let topCat = '';
      let maxCount = 0;
      for (const [cat, count] of historicalCategoryCounts.entries()) {
        if (count > maxCount) {
          maxCount = count;
          topCat = cat;
        }
      }

      const validatedCat = findBestMatchingCategory(topCat, availableCategories) || topCat;
      return {
        category: validatedCat,
        confidence: maxCount >= 3 ? 0.95 : 0.85,
        source: 'history',
        matchedTerm: query,
      };
    }
  }

  // 2. Keyword & Merchant Dictionary Pattern Match
  const tokens = query.split(/[\s,./\-_+&]+/);

  for (const rule of KEYWORD_CATEGORY_RULES) {
    for (const kw of rule.keywords) {
      // Check full string contains keyword or token exact match
      const kwLower = kw.toLowerCase();
      const isMatch =
        query === kwLower ||
        query.includes(kwLower) ||
        tokens.some((token) => token === kwLower || (kwLower.length > 3 && token.includes(kwLower)));

      if (isMatch) {
        const validatedCat = findBestMatchingCategory(rule.targetCategory, availableCategories);
        if (validatedCat) {
          return {
            category: validatedCat,
            confidence: 0.88,
            source: 'keyword',
            matchedTerm: kw,
          };
        }
      }
    }
  }

  return null;
}
