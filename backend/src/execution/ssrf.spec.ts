import {
  BlockedAddressError,
  DnsFailureError,
  isAllowedProtocol,
  isBlockedAddress,
  resolveAndScreen,
  stripBrackets,
} from './ssrf';

describe('isBlockedAddress — IPv4', () => {
  it.each([
    ['0.0.0.0', 'this host'],
    ['0.1.2.3', '0.0.0.0/8'],
    ['10.0.0.1', 'RFC1918'],
    ['172.16.0.1', 'RFC1918'],
    ['172.31.255.255', 'RFC1918'],
    ['192.168.1.1', 'RFC1918'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['169.254.1.1', 'link-local'],
    ['169.254.169.254', 'cloud metadata'],
    ['100.64.0.1', 'CGNAT'],
    ['100.127.255.255', 'CGNAT'],
    ['192.0.0.1', 'special-use'],
    ['192.0.2.1', 'TEST-NET-1'],
    ['198.18.0.1', 'benchmarking'],
    ['198.19.255.255', 'benchmarking'],
    ['198.51.100.1', 'TEST-NET-2'],
    ['203.0.113.1', 'TEST-NET-3'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    ['1.1.1.1'],
    ['8.8.8.8'],
    ['172.15.0.1'], // just outside 172.16/12
    ['172.32.0.1'], // just outside 172.16/12
    ['100.63.255.255'], // just outside 100.64/10
    ['100.128.0.1'], // just outside 100.64/10
    ['192.0.1.1'], // just outside 192.0.0/24 and 192.0.2/24
    ['198.20.0.1'], // just outside 198.18/15
    ['223.255.255.255'], // just below multicast
  ])('allows %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe('isBlockedAddress — IPv6', () => {
  it.each([
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['fc00::1', 'unique-local'],
    ['fd00::1', 'unique-local'],
    ['fd00:ec2::254', 'AWS IMDSv6'],
    ['fe80::1', 'link-local'],
    ['ff02::1', 'multicast'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    ['2606:4700:4700::1111'],
    ['2001:4860:4860::8888'],
  ])('allows %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  // ⚠️ The cases naive implementations lose. Each of these reaches loopback
  // while passing a v6-only range check that only knows about `::1`.
  it.each([
    ['::ffff:127.0.0.1', 'IPv4-mapped, dotted'],
    ['::ffff:7f00:1', 'IPv4-mapped, hex — the form Node normalizes to'],
    ['64:ff9b::7f00:1', 'NAT64'],
    ['64:ff9b::127.0.0.1', 'NAT64, dotted'],
    ['2002:7f00:1::', '6to4'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata endpoint'],
    ['2002:a9fe:a9fe::', '6to4 metadata endpoint'],
  ])('unwraps and blocks %s (%s)', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it('allows an IPv4-mapped public address', () => {
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('allows a 6to4 address wrapping a public IPv4', () => {
    expect(isBlockedAddress('2002:0808:0808::')).toBe(false);
  });

  it('ignores a zone id', () => {
    expect(isBlockedAddress('fe80::1%eth0')).toBe(true);
  });
});

describe('isBlockedAddress — fail closed', () => {
  it.each([['not-an-ip'], [''], ['[::1]'], ['999.999.999.999']])(
    'blocks the unparseable input %p',
    (input) => {
      expect(isBlockedAddress(input)).toBe(true);
    },
  );
});

describe('stripBrackets', () => {
  it('strips an IPv6 literal', () => {
    expect(stripBrackets('[::1]')).toBe('::1');
  });

  it('leaves a hostname alone', () => {
    expect(stripBrackets('example.test')).toBe('example.test');
  });
});

describe('resolveAndScreen', () => {
  const strict = { allowPrivateNetwork: false, isBlockedAddress };

  const reject = async (promise: Promise<unknown>) => {
    try {
      await promise;
      throw new Error('expected a rejection');
    } catch (error) {
      return error;
    }
  };

  it('screens a literal without touching DNS', async () => {
    const lookup = jest.fn();
    await expect(
      resolveAndScreen('93.184.216.34', { ...strict, lookup: lookup as never }),
    ).resolves.toEqual(['93.184.216.34']);
    expect(lookup).not.toHaveBeenCalled();
  });

  // ⚠️ Whole-URL forms, not bare strings: `url.hostname` keeps the brackets,
  // and without stripping them the entire IPv6 table above is unreachable.
  it.each([
    ['http://[::1]/'],
    ['http://[::ffff:127.0.0.1]/'],
    ['http://[64:ff9b::7f00:1]/'],
    ['http://[2002:7f00:1::]/'],
  ])('blocks the IPv6 literal in %s', async (href) => {
    const error = await reject(
      resolveAndScreen(new URL(href).hostname, strict),
    );
    expect(error).toBeInstanceOf(BlockedAddressError);
  });

  // `new URL()` normalizes these to 127.0.0.1, which is what makes them safe —
  // provided `url.hostname` is what gets screened, never the raw input.
  it.each([
    ['http://2130706433/', 'decimal'],
    ['http://0177.0.0.1/', 'octal'],
    ['http://0x7f.1/', 'hex'],
    ['http://127.1/', 'short form'],
  ])('blocks the normalized IPv4 literal in %s (%s)', async (href) => {
    const url = new URL(href);
    expect(url.hostname).toBe('127.0.0.1');
    const error = await reject(resolveAndScreen(url.hostname, strict));
    expect(error).toBeInstanceOf(BlockedAddressError);
  });

  it('screens every resolved address and fails if any is blocked', async () => {
    // A name resolving to both a public and a private address is a rebinding
    // attack. Filtering and using the survivor only delays it.
    const lookup = jest.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);

    const error = await reject(
      resolveAndScreen('rebind.test', { ...strict, lookup: lookup as never }),
    );

    expect(error).toBeInstanceOf(BlockedAddressError);
    expect((error as BlockedAddressError).address).toBe('127.0.0.1');
  });

  it('returns every address when all of them pass', async () => {
    const lookup = jest.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700::1111', family: 6 },
    ]);

    await expect(
      resolveAndScreen('example.test', { ...strict, lookup: lookup as never }),
    ).resolves.toEqual(['93.184.216.34', '2606:4700::1111']);
  });

  it('reports a resolver failure as a DNS failure, not as blocked', async () => {
    const lookup = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));

    const error = await reject(
      resolveAndScreen('nope.test', { ...strict, lookup: lookup as never }),
    );

    expect(error).toBeInstanceOf(DnsFailureError);
  });

  it('reports an empty answer as a DNS failure', async () => {
    const lookup = jest.fn().mockResolvedValue([]);

    const error = await reject(
      resolveAndScreen('empty.test', { ...strict, lookup: lookup as never }),
    );

    expect(error).toBeInstanceOf(DnsFailureError);
  });

  it('skips screening under allowPrivateNetwork but still resolves and returns', async () => {
    const lookup = jest
      .fn()
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    await expect(
      resolveAndScreen('localhost.test', {
        allowPrivateNetwork: true,
        isBlockedAddress,
        lookup: lookup as never,
      }),
    ).resolves.toEqual(['127.0.0.1']);
    expect(lookup).toHaveBeenCalled();
  });

  it('uses the injected predicate, so a test can allow one loopback address and block another', async () => {
    // This is what makes `send.e2e-spec.ts` expressible: the fixture lives on
    // 127.0.0.1 and the "blocked" marker is 127.0.0.2, both loopback.
    const options = {
      allowPrivateNetwork: false,
      isBlockedAddress: (ip: string) => ip === '127.0.0.2',
    };

    await expect(resolveAndScreen('127.0.0.1', options)).resolves.toEqual([
      '127.0.0.1',
    ]);
    await expect(resolveAndScreen('127.0.0.2', options)).rejects.toBeInstanceOf(
      BlockedAddressError,
    );
  });
});

describe('isAllowedProtocol', () => {
  it.each([['http:'], ['https:']])('allows %s', (protocol) => {
    expect(isAllowedProtocol(protocol)).toBe(true);
  });

  it.each([['file:'], ['ftp:'], ['data:'], ['gopher:'], ['ws:']])(
    'rejects %s',
    (protocol) => {
      expect(isAllowedProtocol(protocol)).toBe(false);
    },
  );
});
