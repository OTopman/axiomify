import httpx
from typing import Optional, Dict, Any, List
from . import types

class ApiClient:
    def __init__(self, base_url: str, token: Optional[str] = None):
        self.base_url = base_url
        self.headers = {"Authorization": f"Bearer {token}"} if token else {}
        self.client = httpx.AsyncClient(base_url=self.base_url, headers=self.headers)


    async def get_assets_all(self) -> Any:
        """
        GET /assets/*
        """
        url = f"/assets/*"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json() if response.content else None


    async def get_graphql(self) -> Any:
        """
        GET /graphql
        """
        url = f"/graphql"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json() if response.content else None


    async def post_graphql(self) -> Any:
        """
        POST /graphql
        """
        url = f"/graphql"
        response = await self.client.post(url)
        response.raise_for_status()
        return response.json() if response.content else None


    async def get_graphql_playground(self) -> Any:
        """
        GET /graphql/playground
        """
        url = f"/graphql/playground"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json() if response.content else None


    async def post_api_users(self, body: Optional[Any] = None) -> Any:
        """
        POST /api/users
        """
        url = f"/api/users"
        response = await self.client.post(url, json=body)
        response.raise_for_status()
        return response.json() if response.content else None


    async def post_api_users_avatar(self, body: Optional[Any] = None) -> Any:
        """
        POST /api/users/avatar
        """
        url = f"/api/users/avatar"
        response = await self.client.post(url, json=body)
        response.raise_for_status()
        return response.json() if response.content else None


    async def get_api_secure-data(self) -> Any:
        """
        GET /api/secure-data
        """
        url = f"/api/secure-data"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json() if response.content else None


    async def get_protected_data(self) -> Any:
        """
        GET /protected/data
        """
        url = f"/protected/data"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json() if response.content else None


    async def get_ping(self) -> Any:
        """
        GET /ping
        """
        url = f"/ping"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json() if response.content else None


    async def get_api_login(self) -> Any:
        """
        GET /api/login
        """
        url = f"/api/login"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json() if response.content else None


    async def get_download(self) -> Any:
        """
        GET /download
        """
        url = f"/download"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json() if response.content else None


    async def get_live-feed(self) -> Any:
        """
        GET /live-feed
        """
        url = f"/live-feed"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json() if response.content else None


    async def get_docs_openapi.json(self) -> Any:
        """
        GET /docs/openapi.json
        """
        url = f"/docs/openapi.json"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json() if response.content else None


    async def get_docs(self) -> Any:
        """
        GET /docs
        """
        url = f"/docs"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json() if response.content else None


