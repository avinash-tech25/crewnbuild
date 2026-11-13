"""Store endpoints under /api/v1 (ported from the old store_manager_routes.py; paths and
answers unchanged, ids are UUIDs).

    /store-manager/...           the Store Manager: catalog and stock, Site Engineer
                                 requests, purchases (Razorpay TEST checkout), payments
    /store/...                   the Site Engineer: stores serving their projects, requests
    /store-builder-requests...   written requests between a Builder and a Store Manager

Every /store-manager route takes the account from require_store_manager, which reads
the role and category from the database on each request.
"""

import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.database.session import get_db
from app.integrations.razorpay import PaymentClient, payment_client
from app.modules.accounts.profile_completion import is_store_manager
from app.modules.identity.models import User
from app.modules.store.builder_request_service import StoreBuilderRequestService
from app.modules.store.overview_service import OverviewService
from app.modules.store.purchase_payment_service import PurchasePaymentService
from app.modules.store.purchase_service import PurchaseService
from app.modules.store.repository import StoreManagerRepository
from app.modules.store.schemas import (
    PurchaseCheckoutCreate,
    PurchaseFailure,
    PurchaseLineReceive,
    PurchaseMockCheckout,
    PurchaseVerify,
    SiteRequestCreate,
    SiteRequestDecision,
    SiteRequestIssue,
    StockUpdate,
    StoreBuilderRequestCreate,
    StoreBuilderRequestRespond,
    StoreItemCreate,
    StoreItemUpdate,
    StorePaymentCreate,
)
from app.modules.store.site_request_service import SiteRequestService
from app.modules.store.stock_service import StockService

router = APIRouter(tags=["Store Manager"])


def require_store_manager(user: User = Depends(current_user)) -> User:
    """The signed-in account, if it is an Engineer in the Store Manager category."""
    if not is_store_manager(user):
        raise HTTPException(status_code=403, detail="Store Manager access required")
    return user


def get_repository(database: Session = Depends(get_db)) -> StoreManagerRepository:
    return StoreManagerRepository(database)


def get_store_overview_service(repository: StoreManagerRepository = Depends(get_repository)) -> OverviewService:
    return OverviewService(repository)


def get_stock_service(repository: StoreManagerRepository = Depends(get_repository)) -> StockService:
    return StockService(repository)


def get_site_request_service(repository: StoreManagerRepository = Depends(get_repository)) -> SiteRequestService:
    return SiteRequestService(repository)


def get_purchase_service(repository: StoreManagerRepository = Depends(get_repository)) -> PurchaseService:
    return PurchaseService(repository)


def get_payment_client(request: Request) -> PaymentClient:
    """The Razorpay TEST client (or the explicit local mock); 503 when not configured."""
    return payment_client(request.app.state.settings)


def get_purchase_payment_service(
    repository: StoreManagerRepository = Depends(get_repository),
    client: PaymentClient = Depends(get_payment_client),
) -> PurchasePaymentService:
    return PurchasePaymentService(repository, client)


def get_store_builder_request_service(
    repository: StoreManagerRepository = Depends(get_repository),
) -> StoreBuilderRequestService:
    return StoreBuilderRequestService(repository)


# ---- the Store Manager ----


@router.get("/store-manager/overview")
def fetch_overview(
    user: User = Depends(require_store_manager), service: OverviewService = Depends(get_store_overview_service)
):
    return service.fetch_overview(user=user)


@router.get("/store-manager/projects")
def list_projects(
    user: User = Depends(require_store_manager), service: OverviewService = Depends(get_store_overview_service)
):
    return service.list_projects(user=user)


@router.get("/store-manager/items")
def list_items(user: User = Depends(require_store_manager), service: StockService = Depends(get_stock_service)):
    return service.list_items(user=user)


@router.post("/store-manager/items", status_code=201)
def create_item(
    payload: StoreItemCreate,
    user: User = Depends(require_store_manager),
    service: StockService = Depends(get_stock_service),
):
    return service.create_item(payload=payload, user=user)


@router.patch("/store-manager/items/{item_id}")
def update_item(
    item_id: uuid.UUID,
    payload: StoreItemUpdate,
    user: User = Depends(require_store_manager),
    service: StockService = Depends(get_stock_service),
):
    return service.update_item(item_id=item_id, payload=payload, user=user)


@router.post("/store-manager/items/{item_id}/stock")
def update_stock(
    item_id: uuid.UUID,
    payload: StockUpdate,
    user: User = Depends(require_store_manager),
    service: StockService = Depends(get_stock_service),
):
    return service.update_stock(item_id=item_id, payload=payload, user=user)


@router.get("/store-manager/items/{item_id}/movements")
def list_movements(
    item_id: uuid.UUID,
    user: User = Depends(require_store_manager),
    service: StockService = Depends(get_stock_service),
):
    return service.list_movements(item_id=item_id, user=user)


@router.get("/store-manager/requests")
def list_requests(
    status: str | None = Query(default=None),
    search: str | None = Query(default=None, max_length=64),
    user: User = Depends(require_store_manager),
    service: SiteRequestService = Depends(get_site_request_service),
):
    return service.list_requests(status=status, user=user, search=search)


@router.post("/store-manager/requests/{request_id}/approve")
def approve_request(
    request_id: uuid.UUID,
    payload: SiteRequestDecision,
    user: User = Depends(require_store_manager),
    service: SiteRequestService = Depends(get_site_request_service),
):
    return service.decide(request_id=request_id, approved=True, payload=payload, user=user)


@router.post("/store-manager/requests/{request_id}/reject")
def reject_request(
    request_id: uuid.UUID,
    payload: SiteRequestDecision,
    user: User = Depends(require_store_manager),
    service: SiteRequestService = Depends(get_site_request_service),
):
    return service.decide(request_id=request_id, approved=False, payload=payload, user=user)


@router.get("/store-manager/requests/{request_id}/purchase-options")
def list_request_purchase_options(
    request_id: uuid.UUID,
    user: User = Depends(require_store_manager),
    service: PurchasePaymentService = Depends(get_purchase_payment_service),
):
    """What a request is short of, and the builder's suppliers selling it."""
    return service.purchase_options(user=user, request_id=request_id)


@router.post("/store-manager/requests/{request_id}/issue")
def issue_request(
    request_id: uuid.UUID,
    payload: SiteRequestIssue | None = Body(default=None),
    user: User = Depends(require_store_manager),
    service: SiteRequestService = Depends(get_site_request_service),
):
    return service.issue(request_id=request_id, user=user, payload=payload)


@router.get("/store-manager/purchases")
def list_purchases(
    user: User = Depends(require_store_manager), service: PurchaseService = Depends(get_purchase_service)
):
    return service.list_orders(user=user)


@router.post("/store-manager/purchases/lines/{line_id}/receive")
def receive_purchase_line(
    line_id: uuid.UUID,
    payload: PurchaseLineReceive | None = Body(default=None),
    user: User = Depends(require_store_manager),
    service: PurchaseService = Depends(get_purchase_service),
):
    return service.receive_line(
        line_id=line_id,
        user=user,
        quantity=payload.quantity if payload else None,
        receipt_key=payload.receipt_key if payload else None,
    )


@router.get("/store-manager/buy/products")
def list_buy_products(
    project_id: uuid.UUID = Query(),
    item_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(require_store_manager),
    service: PurchasePaymentService = Depends(get_purchase_payment_service),
):
    # item_id: only the offers that replenish that store product.
    return service.list_buy_products(user=user, project_id=project_id, item_id=item_id)


@router.post("/store-manager/purchases/checkout", status_code=201)
def checkout_purchase(
    payload: PurchaseCheckoutCreate,
    user: User = Depends(require_store_manager),
    service: PurchasePaymentService = Depends(get_purchase_payment_service),
):
    return service.checkout(payload=payload, user=user)


@router.post("/store-manager/purchases/verify")
def verify_purchase_payment(
    payload: PurchaseVerify,
    user: User = Depends(require_store_manager),
    service: PurchasePaymentService = Depends(get_purchase_payment_service),
):
    return service.verify(
        user, payload.payment_id, payload.razorpay_order_id, payload.razorpay_payment_id, payload.razorpay_signature
    )


@router.post("/store-manager/purchases/failure")
def report_purchase_failure(
    payload: PurchaseFailure,
    user: User = Depends(require_store_manager),
    service: PurchasePaymentService = Depends(get_purchase_payment_service),
):
    return service.report_failure(user, payload.payment_id, payload.code, payload.description)


@router.post("/store-manager/purchases/payments/{payment_id}/check")
def check_purchase_payment(
    payment_id: uuid.UUID,
    user: User = Depends(require_store_manager),
    service: PurchasePaymentService = Depends(get_purchase_payment_service),
):
    return service.check(user, payment_id)


@router.post("/store-manager/purchases/mock-checkout")
def mock_purchase_checkout(
    payload: PurchaseMockCheckout,
    user: User = Depends(require_store_manager),
    service: PurchasePaymentService = Depends(get_purchase_payment_service),
):
    return service.mock_checkout(user, payload.payment_id, payload.outcome == "success")


@router.get("/store-manager/payments")
def list_payments(
    user: User = Depends(require_store_manager), service: PurchaseService = Depends(get_purchase_service)
):
    return service.list_payments(user=user)


@router.post("/store-manager/payments", status_code=201)
def record_payment(
    payload: StorePaymentCreate,
    user: User = Depends(require_store_manager),
    service: PurchaseService = Depends(get_purchase_service),
):
    return service.record_payment(payload=payload, user=user)


# ---- the Site Engineer (any Engineer except a Store Manager, checked in the service) ----


@router.get("/store/site-stores")
def list_site_stores(
    project_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(current_user),
    service: SiteRequestService = Depends(get_site_request_service),
):
    return service.list_stores(project_id=project_id, user=user)


@router.post("/store/site-requests", status_code=201)
def create_site_request(
    payload: SiteRequestCreate,
    user: User = Depends(current_user),
    service: SiteRequestService = Depends(get_site_request_service),
):
    return service.create_request(payload=payload, user=user)


@router.post("/store/site-requests/{request_id}/cancel")
def cancel_site_request(
    request_id: uuid.UUID,
    user: User = Depends(current_user),
    service: SiteRequestService = Depends(get_site_request_service),
):
    return service.cancel_request(request_id=request_id, user=user)


@router.get("/store/site-requests/mine")
def list_my_site_requests(
    project_id: uuid.UUID | None = Query(default=None),
    search: str | None = Query(default=None, max_length=64),
    user: User = Depends(current_user),
    service: SiteRequestService = Depends(get_site_request_service),
):
    return service.list_my_requests(project_id=project_id, user=user, search=search)


# ---- Builder <-> Store Manager requests ----


@router.get("/store-builder-requests")
def list_store_builder_requests(
    user: User = Depends(current_user),
    service: StoreBuilderRequestService = Depends(get_store_builder_request_service),
):
    return service.list_requests(user=user)


@router.post("/store-builder-requests", status_code=201)
def create_store_builder_request(
    payload: StoreBuilderRequestCreate,
    user: User = Depends(current_user),
    service: StoreBuilderRequestService = Depends(get_store_builder_request_service),
):
    return service.create(payload=payload, user=user)


@router.post("/store-builder-requests/{request_id}/respond")
def respond_store_builder_request(
    request_id: uuid.UUID,
    payload: StoreBuilderRequestRespond,
    user: User = Depends(current_user),
    service: StoreBuilderRequestService = Depends(get_store_builder_request_service),
):
    return service.respond(request_id=request_id, payload=payload, user=user)


@router.post("/store-builder-requests/{request_id}/withdraw")
def withdraw_store_builder_request(
    request_id: uuid.UUID,
    user: User = Depends(current_user),
    service: StoreBuilderRequestService = Depends(get_store_builder_request_service),
):
    return service.withdraw(request_id=request_id, user=user)
