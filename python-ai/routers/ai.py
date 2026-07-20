# python-ai/routers/ai.py
import logging
from fastapi import APIRouter, HTTPException, Request
from planner.llm_planner import LLMPlanner
from contracts.planner import (
    PlannerRequest, PlannerResponse,
    ExecuteRequest, ExecuteResponse,
    ReflectRequest, ReflectResponse,
)
from providers.adapter import ProviderAdapter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai")

planner = LLMPlanner()
adapter = ProviderAdapter()

@router.get("/health")
def health():
    provider_status = adapter.health()
    return {
        "status": "ok",
        "provider": provider_status,
    }

@router.post("/plan", response_model=PlannerResponse)
def plan(request: PlannerRequest, http_request: Request):
    try:
        return planner.create_plan(request)
    except Exception as e:
        correlation_id = http_request.headers.get("x-correlation-id", "n/a")
        logger.error(f"event=ai_plan_error correlationId={correlation_id} detail={e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/execute", response_model=ExecuteResponse)
def execute(request: ExecuteRequest, http_request: Request):
    try:
        return planner.execute_plan(request)
    except Exception as e:
        correlation_id = http_request.headers.get("x-correlation-id", "n/a")
        logger.error(f"event=ai_execute_error correlationId={correlation_id} detail={e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/reflect", response_model=ReflectResponse)
def reflect(request: ReflectRequest, http_request: Request):
    try:
        return planner.reflect_on_result(request)
    except Exception as e:
        correlation_id = http_request.headers.get("x-correlation-id", "n/a")
        logger.error(f"event=ai_reflect_error correlationId={correlation_id} detail={e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/memory/{session_id}")
def get_memory(session_id: str):
    try:
        return {
            "sessionId": session_id,
            "data": planner.memory_store.get(session_id),
        }
    except Exception as e:
        logger.error(f"[/ai/memory/{{session_id}}] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/memory/{session_id}")
def clear_memory(session_id: str):
    try:
        planner.memory_store.clear(session_id)
        return {"ok": True}
    except Exception as e:
        logger.error(f"[/ai/memory/{{session_id}} DELETE] {e}")
        raise HTTPException(status_code=500, detail=str(e))