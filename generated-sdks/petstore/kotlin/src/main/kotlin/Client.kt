package axiomifysdkkotlin

import java.net.URL

class ApiClient(private val baseUrl: String, private val token: String? = null) {
    // HTTP client implementation omitted for brevity

    suspend fun list_pets(): Any {
        val url = "$baseUrl/pets"
        // TODO: build URL with query params
        // TODO: execute request and parse JSON
        throw NotImplementedError("SDK Generator is in MVP phase")
    }
}
