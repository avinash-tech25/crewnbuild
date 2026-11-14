/**
 * Where in the property the work is needed, asked once on the booking form.
 *
 * A fixed list rather than free text, because a service charge will later depend
 * on which area was chosen (a bathroom is not priced like a full property), and a
 * price cannot be derived from a sentence somebody typed.
 *
 * The same list is checked again on the backend (Partner/backend/app/schemas/booking.py).
 * Keep the two in step: changing a label here without changing it there makes
 * bookings with the new label be refused.
 */
export const SERVICE_AREAS = [
  'Full Property',
  'Interior',
  'Exterior',
  'Living Room / Hall',
  'Bedroom',
  'Kitchen',
  'Bathroom / Toilet',
  'Dining Area',
  'Balcony',
  'Terrace / Roof',
  'Staircase',
  'Basement',
  'Parking / Garage',
  'Garden / Outdoor Area',
  'Office / Workspace',
  'Shop / Showroom',
  'Warehouse / Storage Area',
  'Common Area',
  'Other',
]
