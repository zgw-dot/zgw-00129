import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, DatePicker, Select, Transfer, Typography, Alert, App as AntdApp } from 'antd';
import { User, Clause } from '../types';
import { authApi, clausesApi, countersignApi } from '../api';
import dayjs, { Dayjs } from 'dayjs';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { RangePicker } = DatePicker;

interface Props {
  open: boolean;
  contractId: string;
  contractName: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface ClauseOption {
  key: string;
  title: string;
  description: string;
  clause_number: string;
}

const CreateCountersignModal: React.FC<Props> = ({ open, contractId, contractName, onClose, onSuccess }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [targetKeys, setTargetKeys] = useState<string[]>([]);
  const [selectedUserKeys, setSelectedUserKeys] = useState<string[]>([]);
  const { message } = AntdApp.useApp();

  useEffect(() => {
    if (!open) return;
    loadData();
  }, [open]);

  const loadData = async () => {
    try {
      const [userList, clauseList] = await Promise.all([
        authApi.users(),
        clausesApi.list({ contract_id: contractId })
      ]);
      setUsers(userList as User[]);
      setClauses(clauseList as Clause[]);
      form.resetFields();
      setTargetKeys([]);
      setSelectedUserKeys([]);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载数据失败');
    }
  };

  const clauseDataSource: ClauseOption[] = clauses.map(c => ({
    key: c.id,
    title: `第${c.clause_number}条 - ${c.title}`,
    description: c.content.slice(0, 80) + (c.content.length > 80 ? '...' : ''),
    clause_number: c.clause_number
  }));

  const handleTransferChange = (nextTargetKeys: React.Key[]) => {
    setTargetKeys(nextTargetKeys.map(k => String(k)));
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      if (selectedUserKeys.length === 0) {
        message.warning('请至少选择一个参与人');
        return;
      }
      if (targetKeys.length === 0) {
        message.warning('请至少选择一条必看条款');
        return;
      }
      setLoading(true);
      const deadlineVal: Dayjs | undefined = values.deadline;
      await countersignApi.create({
        contract_id: contractId,
        round_name: values.round_name,
        description: values.description,
        deadline: deadlineVal ? deadlineVal.toISOString() : undefined,
        participant_ids: selectedUserKeys,
        clause_ids: targetKeys
      });
      message.success('会签回合发起成功');
      onSuccess();
      onClose();
    } catch (e: any) {
      message.error(e.response?.data?.error || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={`发起会签 - ${contractName}`}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="发起会签"
      cancelText="取消"
      confirmLoading={loading}
      width={800}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="round_name"
          label="会签名称"
          rules={[{ required: true, message: '请输入会签名称' }]}
        >
          <Input placeholder="如：第一版合同法务业务联审" maxLength={100} />
        </Form.Item>

        <Form.Item name="description" label="说明">
          <TextArea rows={2} placeholder="可选：简要描述此轮会签的背景和重点" maxLength={500} />
        </Form.Item>

        <Form.Item name="deadline" label="截止时间">
          <DatePicker
            showTime
            style={{ width: '100%' }}
            placeholder="请选择截止日期时间（可选）"
            disabledDate={(current) => current && current < dayjs().startOf('day')}
          />
        </Form.Item>

        <Form.Item label="参与人（法务/业务）" required>
          <Select
            mode="multiple"
            placeholder="请选择参与评审的人员"
            value={selectedUserKeys}
            onChange={setSelectedUserKeys}
            optionFilterProp="label"
            style={{ width: '100%' }}
            options={users.map(u => ({
              value: u.id,
              label: `${u.display_name} (${u.role === 'legal' ? '法务' : u.role === 'business' ? '业务' : '管理员'})`
            }))}
          />
        </Form.Item>

        <Form.Item label="必看条款" required>
          <Transfer
            dataSource={clauseDataSource}
            titles={['可选条款', '必看条款']}
            targetKeys={targetKeys}
            onChange={handleTransferChange as any}
            render={(item) => `${(item as any).clause_number} - ${(item as any).title}`}
            listStyle={{ width: '100%', height: 240 }}
            showSelectAll
            pagination={false}
          />
          <Alert
            style={{ marginTop: 8 }}
            type="info"
            showIcon
            message={`已选择 ${targetKeys.length} 条条款。参与人必须对所有必看条款给出结论后，本回合才能完成。`}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateCountersignModal;
