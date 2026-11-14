import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// Property listings: houses and plots for sale. One module for House Owners and
// Builders alike. The seller is always the signed-in account on the server, so no call
// here sends a seller id.
const FILTER_PARAMS = {
  search: 'search',
  propertyType: 'property_type',
  listingType: 'listing_type',
  pincode: 'pincode',
  city: 'city',
  minPrice: 'min_price',
  maxPrice: 'max_price',
  bedrooms: 'bedrooms',
}

export const propertyApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listings: build.query({ query: (params) => ({ url: '/property-listings', params }) }),
    listing: build.query({ query: (listingId) => ({ url: `/property-listings/${listingId}` }) }),
    myListings: build.query({ query: () => ({ url: '/property-listings/mine' }) }),
    createListing: build.mutation({ query: (details) => ({ url: '/property-listings', method: 'POST', data: details }) }),
    updateListing: build.mutation({
      query: ({ listingId, changes }) => ({ url: `/property-listings/${listingId}`, method: 'PATCH', data: changes }),
    }),
    updateListingStatus: build.mutation({
      query: ({ listingId, status }) => ({ url: `/property-listings/${listingId}/status`, method: 'PATCH', data: { status } }),
    }),
    updateListingImages: build.mutation({
      query: ({ listingId, imageUrls }) => ({ url: `/property-listings/${listingId}/images`, method: 'PUT', data: { image_urls: imageUrls } }),
    }),
    deleteListing: build.mutation({ query: (listingId) => ({ url: `/property-listings/${listingId}`, method: 'DELETE' }) }),
    sendEnquiry: build.mutation({
      query: ({ listingId, offerAmount }) => ({ url: `/property-listings/${listingId}/request`, method: 'POST', data: { offer_amount: offerAmount } }),
    }),
    listingEnquiries: build.query({ query: (listingId) => ({ url: `/property-listings/${listingId}/requests` }) }),
  }),
})

const { endpoints } = propertyApi

/** Published listings any signed-in user may browse. */
export function fetchPropertyListings(filters = {}) {
  const params = {}
  for (const [name, param] of Object.entries(FILTER_PARAMS)) if (filters[name]) params[param] = filters[name]
  return runQuery(endpoints.listings, params)
}

/** One listing. Seller contact is included only when the backend says it may be. */
export const fetchPropertyListing = (listingId) => runQuery(endpoints.listing, listingId)
/** The signed-in seller's own listings, every status included. */
export const fetchMyPropertyListings = () => runQuery(endpoints.myListings)
/** Create a listing. It is stored as a DRAFT; publishing is a separate step. */
export const createPropertyListing = (details) => runMutation(endpoints.createListing, details)
export const updatePropertyListing = (listingId, changes) => runMutation(endpoints.updateListing, { listingId, changes })
/** Publish, withdraw, mark under offer or mark sold. The backend enforces which moves are legal. */
export const updatePropertyListingStatus = (listingId, status) => runMutation(endpoints.updateListingStatus, { listingId, status })
/** Replace the gallery with this list, in this order. URLs come from /files/upload. */
export const updatePropertyListingImages = (listingId, imageUrls) => runMutation(endpoints.updateListingImages, { listingId, imageUrls })
export const deletePropertyListing = (listingId) => runMutation(endpoints.deleteListing, listingId)

/**
 * Send the seller an enquiry about one property. The listing is named by the URL and the
 * seller is read off that listing on the server; the seller answers it on the request
 * screens like any other request.
 */
export function sendPropertyRequest(listingId, offerAmount) {
  const amount = offerAmount === '' || offerAmount === undefined || offerAmount === null ? null : Number(offerAmount)
  return runMutation(endpoints.sendEnquiry, { listingId, offerAmount: amount })
}

/** Enquiries on one of the caller's own listings. */
export const fetchPropertyListingRequests = (listingId) => runQuery(endpoints.listingEnquiries, listingId)
