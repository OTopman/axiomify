import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VariableInput } from '../src/components/VariableInput';

describe('VariableInput component', () => {
  const sampleVariables = [
    {
      key: 'baseUrl',
      value: 'http://localhost:3000',
      environmentName: 'Local',
    },
    { key: 'token', value: 'jwt_secret_token_1234', environmentName: 'Local' },
  ];

  it('renders standard text input with placeholder and value', () => {
    const markup = renderToStaticMarkup(
      <VariableInput
        value="https://api.com/users"
        placeholder="Enter request URL"
        variables={sampleVariables}
        onChange={() => {}}
      />,
    );
    expect(markup).toContain('value="https://api.com/users"');
    expect(markup).toContain('placeholder="Enter request URL"');
  });

  it('renders multiline textarea when multiline is true', () => {
    const markup = renderToStaticMarkup(
      <VariableInput
        multiline
        rows={4}
        value="Sample raw body text"
        variables={sampleVariables}
        onChange={() => {}}
      />,
    );
    expect(markup).toContain('<textarea');
    expect(markup).toContain('rows="4"');
    expect(markup).toContain('Sample raw body text</textarea>');
  });

  it('renders password input with disabled or readOnly attributes', () => {
    const markup = renderToStaticMarkup(
      <VariableInput
        type="password"
        value="secret123"
        disabled
        readOnly
        id="apiKeyField"
        className="custom-api-input"
        variables={sampleVariables}
        onChange={() => {}}
      />,
    );
    expect(markup).toContain('type="password"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('readOnly=""');
    expect(markup).toContain('id="apiKeyField"');
    expect(markup).toContain('class="custom-api-input"');
  });
});
