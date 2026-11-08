import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listLanAddresses, preferredLanAddress } from '../src/network.js'

function nic(address, { internal = false } = {}) {
  return [{ address, family: 'IPv4', internal, mac: '00:00:00:00:00:00', netmask: '255.255.255.0', cidr: `${address}/24` }]
}

test('a real Wi-Fi address outranks virtual adapters', () => {
  const addresses = listLanAddresses({
    'vEthernet (WSL)': nic('172.28.16.1'),
    'vEthernet (Default Switch)': nic('172.20.0.1'),
    'Wi-Fi': nic('192.168.1.23'),
    Ethernet: nic('10.0.0.7'),
    Loopback: nic('127.0.0.1', { internal: true }),
  })
  assert.deepEqual(addresses.map((entry) => entry.ip), ['192.168.1.23', '10.0.0.7', '172.20.0.1', '172.28.16.1'])
  assert.equal(addresses[0].virtual, false)
  assert.equal(preferredLanAddress({
    'vEthernet (WSL)': nic('172.28.16.1'),
    'Wi-Fi': nic('192.168.1.23'),
  }), '192.168.1.23')
})

test('loopback, link-local and public addresses are never offered', () => {
  const addresses = listLanAddresses({
    Loopback: nic('127.0.0.1', { internal: true }),
    APIPA: nic('169.254.10.5'),
    Public: nic('8.8.8.8'),
    Zero: nic('0.0.0.0'),
    'Wi-Fi': nic('192.168.31.8'),
  })
  assert.deepEqual(addresses.map((entry) => entry.ip), ['192.168.31.8'])
})

test('an offline machine yields no addresses instead of a guess', () => {
  assert.deepEqual(listLanAddresses({ Loopback: nic('127.0.0.1', { internal: true }) }), [])
  assert.equal(preferredLanAddress({}), '')
})

test('IPv6-only entries are ignored', () => {
  const addresses = listLanAddresses({
    'Wi-Fi': [{ address: 'fe80::1', family: 'IPv6', internal: false }],
  })
  assert.deepEqual(addresses, [])
})
