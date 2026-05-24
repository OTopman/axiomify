import httpx
from typing import Optional, Dict, Any, List
from . import types

class ApiClient:
    def __init__(self, base_url: str, token: Optional[str] = None):
        self.base_url = base_url
        self.headers = {"Authorization": f"Bearer {token}"} if token else {}
        self.client = httpx.AsyncClient(base_url=self.base_url, headers=self.headers)


    async def list_pets(self) -> Any:
        url = f"/pets"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json() if response.content else None


