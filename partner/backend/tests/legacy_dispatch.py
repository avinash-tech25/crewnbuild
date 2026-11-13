"""Shared helpers for the dispatch tests.

Nearby dispatch needs two things the older tests never had: a booking now carries
the point on the map the requester chose, and a technician is only reachable
while their app is reporting where they are.
"""

from legacy import bearer

# A point in Hyderabad, and technicians placed at known distances from it.
# One degree of latitude is ~111.2 km, which is what these offsets are built from.
HOME = (17.4483, 78.3915)
AT_HOME = HOME
NEAR = (17.45549, 78.3915)  # ~0.8 km north
MID = (17.46269, 78.3915)  # ~1.6 km north
FAR = (17.47888, 78.3915)  # ~3.4 km north, still inside the first 5 km ring
BEYOND_FIRST_RING = (17.5113, 78.3915)  # ~7 km north: only the 10 km ring reaches it
ANOTHER_CITY = (12.9716, 77.5946)  # Bengaluru, ~500 km away


def north_of(point, km):
    """A point `km` kilometres due north of `point`."""
    return (point[0] + km / 111.195, point[1])


def place(client, auth, point):
    """Report where a technician is, as their app does while it is open."""
    response = client.post(
        "/technicians/me/location",
        headers=bearer(auth["access_token"]),
        json={"latitude": point[0], "longitude": point[1], "accuracy": 8},
    )
    assert response.status_code == 200, response.text
    return response.json()


def working(client, onboard, trade="PAINTER", at=AT_HOME, pincode="000405", **kwargs):
    """A technician who has registered AND is reporting a position, so nearby
    dispatch can actually reach them."""
    auth = onboard(trade, pincode, **kwargs)
    if at is not None:
        place(client, auth, at)
    return auth


def book(client, headers, trade, description=None, at=HOME):
    return client.post(
        "/requester/bookings",
        headers=headers,
        json={
            "technician_type": trade,
            "description": description,
            "service_latitude": at[0] if at else None,
            "service_longitude": at[1] if at else None,
        },
    )


def offers(client, auth):
    """The job requests waiting for this technician's answer."""
    response = client.get("/technicians/me/offers", headers=bearer(auth["access_token"]))
    assert response.status_code == 200, response.text
    return response.json()


def offer_ids(client, auth):
    return [offer["booking_id"] for offer in offers(client, auth)]


def jobs(client, auth, bucket="accepted"):
    response = client.get("/technicians/me/jobs", headers=bearer(auth["access_token"]), params={"bucket": bucket})
    assert response.status_code == 200, response.text
    return response.json()


def start_code(client, booking_id, requester_headers=None):
    """The customer's current Start Work code, read the way the customer reads it:
    from their own booking, with their own session. None when there is none to show."""
    requester_headers = requester_headers or getattr(client, "booking_requesters", {}).get(booking_id)
    if not requester_headers:
        return None
    response = client.get(f"/requester/bookings/{booking_id}/start-otp", headers=requester_headers)
    return response.json().get("code") if response.status_code == 200 else None


def act(client, auth, booking_id, action, otp=None):
    """Answer an offer, or move a job already held to its next state.

    "start" goes through the Start Work OTP route like the app does: with the
    customer's current code (or `otp` if given). Without a code to hand -- a
    booking that is not ARRIVED, not this customer's -- a well-formed wrong code
    is sent, so a refusal still comes from the server, never from this helper.
    """
    headers = bearer(auth["access_token"])
    if action in ("accept", "reject", "decline"):
        endpoint = "accept" if action == "accept" else "decline"
        return client.post(f"/technicians/me/offers/{booking_id}/{endpoint}", headers=headers)
    if action == "start":
        code = otp if otp is not None else (start_code(client, booking_id) or "000000")
        return client.post(f"/technicians/me/jobs/{booking_id}/start", headers=headers, json={"otp": code})
    return client.post(f"/technicians/me/jobs/{booking_id}/{action}", headers=headers)


def arrive(client, auth, booking_id, destination):
    """Get the technician actually to the address.

    Arrival is not a button: it happens when a real position is inside the
    arrival radius, so a test that wants an arrived job has to put the technician
    there -- through the one location endpoint, like the app does.
    """
    response = client.post(
        "/technicians/me/location",
        headers=bearer(auth["access_token"]),
        json={"latitude": destination[0], "longitude": destination[1], "accuracy": 8},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["active_job"] is not None and body["active_job"]["booking_id"] == booking_id, body
    return body["active_job"]


def lapse_offers(connection, booking_id):
    """Make every outstanding offer of a booking already past its deadline."""
    from sqlalchemy import text

    connection.execute(
        text(
            "UPDATE partner.booking_offers SET expires_at = now() - interval '1 second' "
            "WHERE booking_id = :id AND status = 'OFFERED'"
        ),
        {"id": booking_id},
    )


def code_of(response):
    """The stable error code of a refused request."""
    detail = response.json().get("detail")
    return detail.get("code") if isinstance(detail, dict) else None
