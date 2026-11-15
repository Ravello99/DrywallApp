import React, { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { siteService } from '../../src/services/siteService';
import RfisTab from '../../src/components/project/RfisTab';
import Footer from '../../src/components/Footer';
import { ui } from '../../src/components/ui';

export default function ForemanRfis() {
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    siteService
      .getSites()
      .then((s: any[]) => setSites(s.map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => undefined);
  }, []);
  return (
    <SafeAreaView style={ui.screen} edges={['bottom']}>
      <ScrollView>
        <RfisTab sites={sites} canRespond={false} canCreate />
        <Footer />
      </ScrollView>
    </SafeAreaView>
  );
}
