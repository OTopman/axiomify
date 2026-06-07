from typing import List, Dict, Optional, Any, Union
from enum import Enum
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict

GetApiUsersResponse = List[Any]

class PostApiUsersRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, protected_namespaces=())

    username: str = Field(..., description="The new username")
    role: Any = Field(..., description="The user role")


class PostApiUsersAvatarRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, protected_namespaces=())

    user_id: str = Field(..., alias="userId")


class GetPingResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, protected_namespaces=())

    message: str = Field(...)


