import Foundation

public class ApiClient {
    public let baseURL: URL
    public var token: String?
    private let session: URLSession

    public init(baseURL: URL, token: String? = nil, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
    }

    public func get_assets_all() async throws -> AnyCodable {
        var components = URLComponents(url: baseURL.appendingPathComponent("/assets/*"), resolvingAgainstBaseURL: true)!
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        if let token = self.token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(AnyCodable.self, from: data)
    }

    public func get_graphql() async throws -> AnyCodable {
        var components = URLComponents(url: baseURL.appendingPathComponent("/graphql"), resolvingAgainstBaseURL: true)!
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        if let token = self.token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(AnyCodable.self, from: data)
    }

    public func post_graphql() async throws -> AnyCodable {
        var components = URLComponents(url: baseURL.appendingPathComponent("/graphql"), resolvingAgainstBaseURL: true)!
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        if let token = self.token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(AnyCodable.self, from: data)
    }

    public func get_graphql_playground() async throws -> AnyCodable {
        var components = URLComponents(url: baseURL.appendingPathComponent("/graphql/playground"), resolvingAgainstBaseURL: true)!
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        if let token = self.token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(AnyCodable.self, from: data)
    }

    public func post_api_users(body: AnyCodable) async throws -> AnyCodable {
        var components = URLComponents(url: baseURL.appendingPathComponent("/api/users"), resolvingAgainstBaseURL: true)!
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        if let token = self.token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(AnyCodable.self, from: data)
    }

    public func post_api_users_avatar(body: AnyCodable) async throws -> AnyCodable {
        var components = URLComponents(url: baseURL.appendingPathComponent("/api/users/avatar"), resolvingAgainstBaseURL: true)!
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        if let token = self.token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(AnyCodable.self, from: data)
    }

    public func get_api_secure-data() async throws -> AnyCodable {
        var components = URLComponents(url: baseURL.appendingPathComponent("/api/secure-data"), resolvingAgainstBaseURL: true)!
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        if let token = self.token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(AnyCodable.self, from: data)
    }

    public func get_protected_data() async throws -> AnyCodable {
        var components = URLComponents(url: baseURL.appendingPathComponent("/protected/data"), resolvingAgainstBaseURL: true)!
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        if let token = self.token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(AnyCodable.self, from: data)
    }

    public func get_ping() async throws -> AnyCodable {
        var components = URLComponents(url: baseURL.appendingPathComponent("/ping"), resolvingAgainstBaseURL: true)!
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        if let token = self.token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(AnyCodable.self, from: data)
    }

    public func get_api_login() async throws -> AnyCodable {
        var components = URLComponents(url: baseURL.appendingPathComponent("/api/login"), resolvingAgainstBaseURL: true)!
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        if let token = self.token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(AnyCodable.self, from: data)
    }

    public func get_download() async throws -> AnyCodable {
        var components = URLComponents(url: baseURL.appendingPathComponent("/download"), resolvingAgainstBaseURL: true)!
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        if let token = self.token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(AnyCodable.self, from: data)
    }

    public func get_live-feed() async throws -> AnyCodable {
        var components = URLComponents(url: baseURL.appendingPathComponent("/live-feed"), resolvingAgainstBaseURL: true)!
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        if let token = self.token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(AnyCodable.self, from: data)
    }

    public func get_docs_openapi.json() async throws -> AnyCodable {
        var components = URLComponents(url: baseURL.appendingPathComponent("/docs/openapi.json"), resolvingAgainstBaseURL: true)!
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        if let token = self.token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(AnyCodable.self, from: data)
    }

    public func get_docs() async throws -> AnyCodable {
        var components = URLComponents(url: baseURL.appendingPathComponent("/docs"), resolvingAgainstBaseURL: true)!
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        if let token = self.token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(AnyCodable.self, from: data)
    }
}
