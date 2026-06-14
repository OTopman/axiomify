import httpx
from typing import Optional, Dict, Any, List, Union
from datetime import datetime
from . import types

class ApiClient:
    def __init__(self, base_url: str, token: Optional[str] = None):
        self.base_url = base_url
        self.headers = {"Authorization": f"Bearer {token}"} if token else {}
        self.client = httpx.AsyncClient(base_url=self.base_url, headers=self.headers)

    async def close(self):
        await self.client.aclose()


    async def get_metrics(self) -> None:
        url = f"/metrics"
        response = await self.client.get(url)
        response.raise_for_status()
        return None


    async def get_assets_all(self) -> None:
        url = f"/assets/*"
        response = await self.client.get(url)
        response.raise_for_status()
        return None


    async def get_api_users(self) -> types.GetApiUsersResponse:
        url = f"/api/users"
        response = await self.client.get(url)
        response.raise_for_status()
        return types.GetApiUsersResponse.model_validate(response.json())


    async def post_api_users(self, body: types.PostApiUsersRequest) -> None:
        url = f"/api/users"
        req_body = body.model_dump(by_alias=True) if hasattr(body, 'model_dump') else body
        response = await self.client.post(url, json=req_body)
        response.raise_for_status()
        return None


    async def post_api_users_avatar(self, body: types.PostApiUsersAvatarRequest) -> None:
        url = f"/api/users/avatar"
        req_body = body.model_dump(by_alias=True) if hasattr(body, 'model_dump') else body
        response = await self.client.post(url, json=req_body)
        response.raise_for_status()
        return None


    async def post_graphql(self) -> None:
        url = f"/graphql"
        response = await self.client.post(url)
        response.raise_for_status()
        return None


    async def get_graphql(self) -> None:
        url = f"/graphql"
        response = await self.client.get(url)
        response.raise_for_status()
        return None


    async def get_graphql_playground(self) -> None:
        url = f"/graphql/playground"
        response = await self.client.get(url)
        response.raise_for_status()
        return None


    async def post_api_checkout(self, body: types.PostApiCheckoutRequest) -> None:
        url = f"/api/checkout"
        req_body = body.model_dump(by_alias=True) if hasattr(body, 'model_dump') else body
        response = await self.client.post(url, json=req_body)
        response.raise_for_status()
        return None


    async def get_api_secure_data(self) -> None:
        url = f"/api/secure-data"
        response = await self.client.get(url)
        response.raise_for_status()
        return None


    async def get_protected_data(self) -> None:
        url = f"/protected/data"
        response = await self.client.get(url)
        response.raise_for_status()
        return None


    async def get_ping(self) -> types.GetPingResponse:
        url = f"/ping"
        response = await self.client.get(url)
        response.raise_for_status()
        return types.GetPingResponse.model_validate(response.json())


    async def get_api_login(self) -> None:
        url = f"/api/login"
        response = await self.client.get(url)
        response.raise_for_status()
        return None


    async def get_download(self) -> None:
        url = f"/download"
        response = await self.client.get(url)
        response.raise_for_status()
        return None


    async def get_live_feed(self) -> None:
        url = f"/live-feed"
        response = await self.client.get(url)
        response.raise_for_status()
        return None


    async def get_docs_openapi_json(self) -> None:
        url = f"/docs/openapi.json"
        response = await self.client.get(url)
        response.raise_for_status()
        return None


    async def get_docs(self) -> None:
        url = f"/docs"
        response = await self.client.get(url)
        response.raise_for_status()
        return None


